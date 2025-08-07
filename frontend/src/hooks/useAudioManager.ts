import { useState, useRef, useCallback, useEffect } from 'react';

// Global connection manager to prevent multiple connections
class GlobalAudioManager {
  private static instance: GlobalAudioManager;
  
  public websocket: WebSocket | null = null;
  public connectionId: string | null = null;
  public isConnected: boolean = false;
  public isInitializing: boolean = false;
  public activeInstances: Set<string> = new Set();
  
  static getInstance(): GlobalAudioManager {
    if (!GlobalAudioManager.instance) {
      GlobalAudioManager.instance = new GlobalAudioManager();
    }
    return GlobalAudioManager.instance;
  }
  
  registerInstance(instanceId: string): void {
    this.activeInstances.add(instanceId);
    console.log(`Registered audio manager instance: ${instanceId}, total: ${this.activeInstances.size}`);
  }
  
  unregisterInstance(instanceId: string): void {
    this.activeInstances.delete(instanceId);
    console.log(`Unregistered audio manager instance: ${instanceId}, remaining: ${this.activeInstances.size}`);
    
    // If no instances remain, clean up the global connection
    if (this.activeInstances.size === 0 && this.websocket) {
      console.log('No instances remaining, cleaning up global WebSocket');
      try {
        this.websocket.close(1000, 'No active instances');
      } catch (e) {
        console.warn('Error closing WebSocket:', e);
      }
      this.websocket = null;
      this.connectionId = null;
      this.isConnected = false;
      this.isInitializing = false;
    }
  }
}

const globalAudioManager = GlobalAudioManager.getInstance();

// Simple linear interpolation resampling
const resampleAudio = (input: Float32Array, inputSampleRate: number, outputSampleRate: number): Float32Array => {
  if (inputSampleRate === outputSampleRate) return input;
  
  const ratio = inputSampleRate / outputSampleRate;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Float32Array(outputLength);
  
  for (let i = 0; i < outputLength; i++) {
    const index = i * ratio;
    const indexFloor = Math.floor(index);
    const indexCeil = Math.min(indexFloor + 1, input.length - 1);
    const fraction = index - indexFloor;
    
    output[i] = input[indexFloor] * (1 - fraction) + input[indexCeil] * fraction;
  }
  
  return output;
};

export type AudioState = 'idle' | 'listening' | 'processing' | 'speaking';

interface UseAudioManagerReturn {
  audioState: AudioState;
  isListening: boolean;
  isProcessing: boolean;
  isSpeaking: boolean;
  currentTranscript: string;
  currentResponse: string;
  error: string | null;
  startListening: () => Promise<void>;
  stopListening: () => void;
  pauseListening: () => void;
  resumeListening: () => void;
}

export const useAudioManager = (): UseAudioManagerReturn => {
  const [audioState, setAudioState] = useState<AudioState>('idle');
  const [currentTranscript, setCurrentTranscript] = useState('');
  const [currentResponse, setCurrentResponse] = useState('');
  const [error, setError] = useState<string | null>(null);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const websocketRef = useRef<WebSocket | null>(null);
  const connectionIdRef = useRef<string | null>(null);
  const isConnectedRef = useRef<boolean>(false);
  const instanceIdRef = useRef<string>(Math.random().toString(36).substr(2, 9));
  
  // Register this instance on mount
  useEffect(() => {
    const instanceId = instanceIdRef.current;
    console.log(`Audio manager instance ${instanceId} mounting`);
    globalAudioManager.registerInstance(instanceId);
    
    return () => {
      console.log(`Audio manager instance ${instanceId} unmounting`);
      globalAudioManager.unregisterInstance(instanceId);
    };
  }, []);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const isPausedRef = useRef<boolean>(false);
  
  // Add refs for sequencing and debouncing
  const isProcessingSequenceRef = useRef<boolean>(false);
  const lastTranscriptRef = useRef<string>('');
  const lastResponseRef = useRef<string>('');
  const debounceTimeoutRef = useRef<number | null>(null);
  
  const SAMPLE_RATE = 16000;

  // Derived states
  const isListening = audioState === 'listening';
  const isProcessing = audioState === 'processing';
  const isSpeaking = audioState === 'speaking';

  const setAudioStateWithLog = useCallback((newState: AudioState) => {
    console.log(`Audio state transition: ${audioState} → ${newState}`);
    setAudioState(newState);
  }, [audioState]);
  
  // Debounced state setter to prevent rapid state changes
  const setAudioStateDebounced = useCallback((newState: AudioState, delay: number = 100) => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }
    
    debounceTimeoutRef.current = window.setTimeout(() => {
      setAudioStateWithLog(newState);
      debounceTimeoutRef.current = null;
    }, delay);
  }, [setAudioStateWithLog]);

  const playTTSAudio = useCallback(async (audioDataHex: string) => {
    try {
      // Convert hex string to binary
      const audioBytes = new Uint8Array(
        audioDataHex.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []
      );
      
      // Create audio blob and play
      const audioBlob = new Blob([audioBytes], { type: 'audio/wav' });
      const audioUrl = URL.createObjectURL(audioBlob);
      
      // Stop any existing audio
      if (audioPlayerRef.current) {
        audioPlayerRef.current.pause();
        audioPlayerRef.current = null;
      }
      
      const audio = new Audio(audioUrl);
      audioPlayerRef.current = audio;
      
      audio.onended = () => {
        console.log('TTS playback finished, resuming listening');
        URL.revokeObjectURL(audioUrl);
        audioPlayerRef.current = null;
        
        // Reset processing sequence
        isProcessingSequenceRef.current = false;
        
        // Resume listening after TTS finishes (if not manually paused)
        if (!isPausedRef.current) {
          setAudioStateDebounced('listening');
        }
      };
      
      audio.onerror = (err) => {
        console.error('Audio playback error:', err);
        URL.revokeObjectURL(audioUrl);
        audioPlayerRef.current = null;
        
        // Reset processing sequence
        isProcessingSequenceRef.current = false;
        
        // Resume listening on error (if not manually paused)
        if (!isPausedRef.current) {
          setAudioStateDebounced('listening');
        }
      };
      
      await audio.play();
    } catch (error) {
      console.error('Error playing TTS audio:', error);
      
      // Reset processing sequence
      isProcessingSequenceRef.current = false;
      
      // Resume listening on error (if not manually paused)
      if (!isPausedRef.current) {
        setAudioStateDebounced('listening');
      }
    }
  }, [setAudioStateDebounced]);

  const initializeWebSocket = useCallback(async () => {
    // Check if we already have a global connection
    if (globalAudioManager.websocket && globalAudioManager.isConnected && globalAudioManager.websocket.readyState === WebSocket.OPEN) {
      console.log(`Instance ${instanceIdRef.current}: Reusing existing WebSocket connection`);
      websocketRef.current = globalAudioManager.websocket;
      connectionIdRef.current = globalAudioManager.connectionId;
      isConnectedRef.current = true;
      return;
    }
    
    // Prevent multiple simultaneous connection attempts
    if (globalAudioManager.isInitializing) {
      console.log(`Instance ${instanceIdRef.current}: Connection already initializing, waiting...`);
      // Wait for the other connection attempt to complete
      let attempts = 0;
      while (globalAudioManager.isInitializing && attempts < 50) { // 5 second timeout
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }
      if (globalAudioManager.websocket && globalAudioManager.isConnected) {
        websocketRef.current = globalAudioManager.websocket;
        connectionIdRef.current = globalAudioManager.connectionId;
        isConnectedRef.current = true;
        return;
      }
    }
    
    globalAudioManager.isInitializing = true;
    
    // Clean up any existing connections
    if (globalAudioManager.websocket) {
      try {
        globalAudioManager.websocket.close();
      } catch (e) {
        console.warn('Error closing existing WebSocket:', e);
      }
      globalAudioManager.websocket = null;
      globalAudioManager.connectionId = null;
      globalAudioManager.isConnected = false;
    }
    
    console.log(`Instance ${instanceIdRef.current}: Initializing NEW WebSocket connection to ws://localhost:8000/api/v1/streaming/ws...`);
    
    // Add a small delay to prevent rapid reconnection attempts
    await new Promise(resolve => setTimeout(resolve, 500));
    
    try {
      const ws = new WebSocket('ws://localhost:8000/api/v1/streaming/ws');
      globalAudioManager.websocket = ws;
      
      ws.onopen = () => {
        console.log(`Instance ${instanceIdRef.current}: WebSocket connected for audio management`);
        globalAudioManager.isConnected = true;
        isConnectedRef.current = true;
        globalAudioManager.isInitializing = false;
        setError(null);
      };
    
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'connection_established') {
            console.log(`Instance ${instanceIdRef.current}: Connection established with ID:`, data.connection_id);
            connectionIdRef.current = data.connection_id;
            globalAudioManager.connectionId = data.connection_id;
          } 
          else if (data.type === 'transcription_response') {
            if (data.success && data.text && data.text !== lastTranscriptRef.current) {
              // Prevent processing duplicate transcriptions
              if (isProcessingSequenceRef.current) {
                console.log('Skipping transcription - already processing sequence');
                return;
              }
              
              console.log('Transcription received:', data.text);
              lastTranscriptRef.current = data.text;
              setCurrentTranscript(data.text);
              setAudioStateWithLog('processing');
              
              // Mark sequence as processing
              isProcessingSequenceRef.current = true;
              
              // Send chat request immediately after transcription
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                  type: 'chat_request',
                  message: data.text
                }));
              }
            } else {
              // No text transcribed, resume listening
              if (!isPausedRef.current && !isProcessingSequenceRef.current) {
                setAudioStateDebounced('listening');
              }
            }
          } 
          else if (data.type === 'chat_response') {
            if (data.success && data.message && data.message !== lastResponseRef.current) {
              console.log('Chat response received:', data.message);
              lastResponseRef.current = data.message;
              setCurrentResponse(data.message);
              
              // Request TTS for the response
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                  type: 'tts_request',
                  text: data.message
                }));
              }
            } else {
              // Chat failed, resume listening
              isProcessingSequenceRef.current = false;
              if (!isPausedRef.current) {
                setAudioStateDebounced('listening');
              }
            }
          } 
          else if (data.type === 'tts_processing') {
            console.log(`Instance ${instanceIdRef.current}: TTS processing started...`);
            // Keep processing state, don't change to listening yet
          }
          else if (data.type === 'tts_response') {
            if (data.success && data.audio_data) {
              console.log(`Instance ${instanceIdRef.current}: TTS audio received, starting playback`);
              setAudioStateWithLog('speaking');
              playTTSAudio(data.audio_data);
            } else if (data.timeout) {
              // TTS timed out, show text response and resume listening
              console.warn(`Instance ${instanceIdRef.current}: TTS timed out, showing text response`);
              if (data.fallback_text) {
                setCurrentResponse(data.fallback_text);
              }
              isProcessingSequenceRef.current = false;
              if (!isPausedRef.current) {
                setAudioStateDebounced('listening');
              }
            } else {
              // TTS failed, resume listening
              console.error(`Instance ${instanceIdRef.current}: TTS failed:`, data.error);
              isProcessingSequenceRef.current = false;
              if (!isPausedRef.current) {
                setAudioStateDebounced('listening');
              }
            }
          }
          else if (data.type === 'error') {
            console.error('WebSocket error from server:', data.message);
            setError(data.message);
            isProcessingSequenceRef.current = false;
          }
        } catch (err) {
          console.error('WebSocket message error:', err);
          isProcessingSequenceRef.current = false;
        }
      };
    
      ws.onerror = (event) => {
        console.error(`Instance ${instanceIdRef.current}: WebSocket error:`, event);
        globalAudioManager.isConnected = false;
        isConnectedRef.current = false;
        globalAudioManager.isInitializing = false;
        setError('WebSocket connection error');
      };
      
      ws.onclose = (event) => {
        console.log(`Instance ${instanceIdRef.current}: WebSocket disconnected: ${event.code} - ${event.reason}`);
        globalAudioManager.isConnected = false;
        isConnectedRef.current = false;
        globalAudioManager.isInitializing = false;
        websocketRef.current = null;
        
        // Only reset globals if this was the active connection
        if (globalAudioManager.websocket === ws) {
          globalAudioManager.websocket = null;
          globalAudioManager.connectionId = null;
        }
        
        if (event.code === 1012) {
          setError('Service restarting...');
        } else if (event.code === 1006) {
          setError('Connection failed - check if backend is running');
        } else if (event.code !== 1000) {
          setError('Connection lost');
        }
      };
      
      websocketRef.current = ws;
    } catch (error) {
      console.error(`Instance ${instanceIdRef.current}: Failed to create WebSocket:`, error);
      globalAudioManager.isInitializing = false;
      setError('Failed to create WebSocket connection');
    }
  }, [setAudioStateDebounced, setAudioStateWithLog, playTTSAudio]);

  const startListening = useCallback(async () => {
    try {
      setError(null);
      isPausedRef.current = false;
      
      // First check available audio devices
      console.log(`Instance ${instanceIdRef.current}: Checking available audio devices...`);
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(device => device.kind === 'audioinput');
        console.log(`Instance ${instanceIdRef.current}: Found ${audioInputs.length} audio input devices:`, 
          audioInputs.map(d => ({ deviceId: d.deviceId, label: d.label || 'Unknown device' })));
      } catch (e) {
        console.warn(`Instance ${instanceIdRef.current}: Could not enumerate devices:`, e);
      }
      
      // Request microphone access without forcing sample rate
      console.log(`Instance ${instanceIdRef.current}: Requesting microphone access...`);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: false, // Disable processing to get raw audio
          noiseSuppression: false, // Disable processing to get raw audio  
          autoGainControl: false,  // Disable processing to get raw audio
          sampleRate: 48000        // Request specific sample rate
        }
      });
      
      console.log(`Instance ${instanceIdRef.current}: Microphone access granted`);
      streamRef.current = stream;
      
      // Initialize audio context with default sample rate (let browser decide)
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      
      // Get the actual sample rates and track info
      const audioTrack = stream.getAudioTracks()[0];
      const settings = audioTrack.getSettings();
      const streamSampleRate = settings.sampleRate || audioContext.sampleRate;
      
      console.log(`Instance ${instanceIdRef.current}: Stream sample rate:`, streamSampleRate);
      console.log(`Instance ${instanceIdRef.current}: AudioContext sample rate:`, audioContext.sampleRate);
      console.log(`Instance ${instanceIdRef.current}: Audio track settings:`, settings);
      console.log(`Instance ${instanceIdRef.current}: Audio track state:`, audioTrack.readyState);
      console.log(`Instance ${instanceIdRef.current}: Audio track enabled:`, audioTrack.enabled);
      console.log(`Instance ${instanceIdRef.current}: Audio track muted:`, audioTrack.muted);
      console.log(`Instance ${instanceIdRef.current}: Audio track kind:`, audioTrack.kind);
      console.log(`Instance ${instanceIdRef.current}: Audio track label:`, audioTrack.label);
      
      // Test if we can get any audio data from the stream
      console.log(`Instance ${instanceIdRef.current}: Stream active:`, stream.active);
      console.log(`Instance ${instanceIdRef.current}: Stream id:`, stream.id);
      console.log(`Instance ${instanceIdRef.current}: Number of audio tracks:`, stream.getAudioTracks().length);
      
      // Resume audio context if suspended (required by Chrome)
      if (audioContext.state === 'suspended') {
        console.log(`Instance ${instanceIdRef.current}: AudioContext suspended, attempting to resume...`);
        await audioContext.resume();
        console.log(`Instance ${instanceIdRef.current}: AudioContext resume result:`, audioContext.state);
      }
      
      console.log(`Instance ${instanceIdRef.current}: Audio context state:`, audioContext.state);
      
      // Check if the microphone track is actually producing audio
      audioTrack.onended = () => {
        console.warn(`Instance ${instanceIdRef.current}: Audio track ended`);
      };
      
      audioTrack.onmute = () => {
        console.warn(`Instance ${instanceIdRef.current}: Audio track muted`);
      };
      
      audioTrack.onunmute = () => {
        console.log(`Instance ${instanceIdRef.current}: Audio track unmuted`);
      };
      
      // Use Web Audio API with PCM conversion instead of MediaRecorder
      try {
        const source = audioContext.createMediaStreamSource(stream);
        console.log(`Instance ${instanceIdRef.current}: MediaStreamSource created`);
        
        // Create an analyzer to check if we're getting any audio signal
        const analyzer = audioContext.createAnalyser();
        analyzer.fftSize = 256;
        const bufferLength = analyzer.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        
        source.connect(analyzer);
        
        // Test audio levels periodically
        const checkAudioLevel = () => {
          analyzer.getByteFrequencyData(dataArray);
          const average = dataArray.reduce((a, b) => a + b) / bufferLength;
          const max = Math.max(...dataArray);
          if (average > 0 || max > 0) {
            console.log(`Instance ${instanceIdRef.current}: Analyzer detected audio - Average: ${average.toFixed(1)}, Max: ${max}`);
          } else {
            console.log(`Instance ${instanceIdRef.current}: Analyzer: No audio detected (avg: ${average}, max: ${max})`);
          }
        };
        
        // Check audio levels every 2 seconds
        const levelCheckInterval = setInterval(checkAudioLevel, 2000);
        
        // Clean up interval when stopping
        const originalStopListening = stopListening;
        // Store interval ID for cleanup (we'll handle this in the cleanup)
        
        const processor = audioContext.createScriptProcessor(2048, 1, 1);
        console.log(`Instance ${instanceIdRef.current}: ScriptProcessor created with buffer size: 2048`);
        
        processor.onaudioprocess = (event) => {
          if (!isPausedRef.current && websocketRef.current?.readyState === WebSocket.OPEN) {
            const inputData = event.inputBuffer.getChannelData(0);
            
            // Debug: Check if we're getting any audio input
            const rms = Math.sqrt(inputData.reduce((sum, sample) => sum + sample * sample, 0) / inputData.length);
            const maxAmplitude = Math.max(...inputData.map(Math.abs));
            
            console.log(`Instance ${instanceIdRef.current}: Audio Input - RMS: ${rms.toFixed(4)}, Max: ${maxAmplitude.toFixed(4)}, Length: ${inputData.length}`);
            
            // Check for completely silent audio
            if (maxAmplitude < 0.0001) {
              console.warn(`Instance ${instanceIdRef.current}: WARNING - Audio input appears to be silent (max amplitude: ${maxAmplitude})`);
            }
            
            // Resample to 16kHz if needed
            const ratio = audioContext.sampleRate / SAMPLE_RATE;
            const targetLength = Math.floor(inputData.length / ratio);
            const resampled = new Float32Array(targetLength);
            
            for (let i = 0; i < targetLength; i++) {
              const sourceIndex = Math.floor(i * ratio);
              resampled[i] = inputData[sourceIndex] || 0;
            }
            
            // Convert to 16-bit PCM
            const int16Array = new Int16Array(resampled.length);
            for (let i = 0; i < resampled.length; i++) {
              const sample = Math.max(-1, Math.min(1, resampled[i]));
              int16Array[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
            }
            
            // Debug: Check PCM conversion
            const pcmRms = Math.sqrt(int16Array.reduce((sum, sample) => sum + sample * sample, 0) / int16Array.length);
            const pcmMax = Math.max(...int16Array.map(Math.abs));
            console.log(`Instance ${instanceIdRef.current}: PCM Output - RMS: ${pcmRms.toFixed(1)}, Max: ${pcmMax}, First 10 samples: [${Array.from(int16Array.slice(0, 10)).join(', ')}]`);
            
            // Send PCM data with connection validation
            if (websocketRef.current && websocketRef.current.readyState === WebSocket.OPEN && connectionIdRef.current) {
              const audioArray = Array.from(new Uint8Array(int16Array.buffer));
              console.log(`Instance ${instanceIdRef.current}: Sending ${audioArray.length} bytes, first 10 bytes: [${audioArray.slice(0, 10).join(', ')}]`);
              
              websocketRef.current.send(JSON.stringify({
                type: 'audio_chunk',
                audio_data: audioArray,
                format: 'pcm',
                sample_rate: SAMPLE_RATE,
                connection_id: connectionIdRef.current
              }));
            }
          }
        };
        
        // Connect audio nodes (but don't route to speakers)
        source.connect(processor);
        
        // IMPORTANT: Connect processor to destination to ensure it stays active
        // This is required for ScriptProcessorNode to fire events
        processor.connect(audioContext.destination);
        
        console.log(`Instance ${instanceIdRef.current}: Audio processing initialized with PCM conversion`);
        console.log(`Instance ${instanceIdRef.current}: Audio graph: MediaStreamSource -> ScriptProcessor -> AudioDestination`);
        
      } catch (audioError) {
        console.error('Audio processing setup failed:', audioError);
        setError('Failed to setup audio processing');
      }
      
      // Initialize WebSocket
      await initializeWebSocket();
      
      // Start audio processing
      setAudioStateWithLog('listening');
      
    } catch (err) {
      console.error('Error starting audio manager:', err);
      setError('Failed to start audio system');
    }
  }, [initializeWebSocket, setAudioStateWithLog]);
  
  const stopListening = useCallback(() => {
    isPausedRef.current = true;
    
    // Reset processing sequence
    isProcessingSequenceRef.current = false;
    
    // Clear debounce timeout
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
      debounceTimeoutRef.current = null;
    }
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      audioPlayerRef.current = null;
    }
    
    if (websocketRef.current) {
      // Only close if this instance owns the connection
      if (websocketRef.current === globalAudioManager.websocket) {
        console.log(`Instance ${instanceIdRef.current}: Closing WebSocket connection`);
        websocketRef.current.close(1000, 'User stopped listening');
        globalAudioManager.websocket = null;
        globalAudioManager.connectionId = null;
        globalAudioManager.isConnected = false;
      }
      websocketRef.current = null;
    }
    
    isConnectedRef.current = false;
    connectionIdRef.current = null;
    
    setAudioStateWithLog('idle');
    setCurrentTranscript('');
    setCurrentResponse('');
    setError(null);
    
    // Reset tracking refs
    lastTranscriptRef.current = '';
    lastResponseRef.current = '';
  }, [setAudioStateWithLog]);

  const pauseListening = useCallback(() => {
    isPausedRef.current = true;
    setAudioStateWithLog('idle');
  }, [setAudioStateWithLog]);

  const resumeListening = useCallback(() => {
    if (streamRef.current && audioContextRef.current) {
      isPausedRef.current = false;
      setAudioStateWithLog('listening');
    }
  }, [setAudioStateWithLog]);

  // Auto-start listening when component mounts (only for the first instance)
  useEffect(() => {
    const initializeApp = async () => {
      // Only initialize if we don't have an active connection
      if (!globalAudioManager.websocket || !globalAudioManager.isConnected) {
        console.log(`Instance ${instanceIdRef.current}: Starting audio initialization`);
        
        // Add user interaction handler for AudioContext
        const handleUserInteraction = async () => {
          console.log(`Instance ${instanceIdRef.current}: User interaction detected, starting audio`);
          try {
            await startListening();
            // Remove the event listeners once audio is started
            document.removeEventListener('click', handleUserInteraction);
            document.removeEventListener('touchstart', handleUserInteraction);
            document.removeEventListener('keydown', handleUserInteraction);
          } catch (error) {
            console.error('Failed to initialize audio:', error);
            setError('Failed to initialize audio system - please refresh and try again');
          }
        };
        
        // Try to start immediately, but add fallback for user interaction
        try {
          await startListening();
        } catch (error) {
          console.warn('Initial audio start failed, waiting for user interaction:', error);
          setError('Click anywhere to activate microphone');
          
          // Add event listeners for user interaction
          document.addEventListener('click', handleUserInteraction);
          document.addEventListener('touchstart', handleUserInteraction);
          document.addEventListener('keydown', handleUserInteraction);
        }
      } else {
        console.log(`Instance ${instanceIdRef.current}: Using existing audio connection`);
        // Sync with existing connection state
        websocketRef.current = globalAudioManager.websocket;
        connectionIdRef.current = globalAudioManager.connectionId;
        isConnectedRef.current = globalAudioManager.isConnected;
        setAudioStateWithLog('listening');
      }
    };
    
    initializeApp();
  }, []);
  
  // Cleanup when component unmounts
  useEffect(() => {
    return () => {
      console.log(`Instance ${instanceIdRef.current}: Cleaning up on unmount`);
      // Don't call stopListening here as it might close shared connection
      // The global manager will handle cleanup when all instances are gone
    };
  }, []);
  
  return {
    audioState,
    isListening,
    isProcessing,
    isSpeaking,
    currentTranscript,
    currentResponse,
    error,
    startListening,
    stopListening,
    pauseListening,
    resumeListening
  };
};