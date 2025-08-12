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

export interface AudioMetrics {
  rms: number;
  maxAmplitude: number;
  vadDetected: boolean;
  audioState: string;
  connectionId: string | null;
  bufferSize: number;
  bufferDuration: number;
  sampleRate: number;
  timestamp: number;
  vadThreshold?: number;
  baselineNoise?: number;
  calibrated?: boolean;
}

export interface PipelineEvent {
  id: string;
  type: 'audio_capture' | 'vad_trigger' | 'transcription_start' | 'transcription_end' | 'llm_start' | 'llm_end' | 'tts_start' | 'tts_end' | 'playback_start' | 'playback_end' | 'tts_interruption' | 'playback_interrupted';
  timestamp: number;
  data?: any;
  duration?: number;
}

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
  // Debug data
  audioMetrics: AudioMetrics | null;
  pipelineEvents: PipelineEvent[];
  addPipelineEvent: (type: PipelineEvent['type'], data?: any, duration?: number) => void;
}

export const useAudioManager = (): UseAudioManagerReturn => {
  const [audioState, setAudioState] = useState<AudioState>('idle');
  const [currentTranscript, setCurrentTranscript] = useState('');
  const [currentResponse, setCurrentResponse] = useState('');
  const [error, setError] = useState<string | null>(null);
  
  // Debug state
  const [audioMetrics, setAudioMetrics] = useState<AudioMetrics | null>(null);
  const [pipelineEvents, setPipelineEvents] = useState<PipelineEvent[]>([]);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const websocketRef = useRef<WebSocket | null>(null);
  const connectionIdRef = useRef<string | null>(null);
  const isConnectedRef = useRef<boolean>(false);
  const instanceIdRef = useRef<string>(Math.random().toString(36).substr(2, 9));
  const lastVadStateRef = useRef<boolean>(false);
  const vadSessionRef = useRef<{startTime: number | null, speechDuration: number, silenceDuration: number}>(
    {startTime: null, speechDuration: 0, silenceDuration: 0}
  );
  const ttsInterruptionRef = useRef<{
    enabled: boolean;
    speechDetectedDuringTTS: boolean;
    interruptionThreshold: number;
    consecutiveSpeechFrames: number;
    requiredFrames: number;
  }>({
    enabled: true,
    speechDetectedDuringTTS: false,
    interruptionThreshold: 0.003, // Higher threshold during TTS
    consecutiveSpeechFrames: 0,
    requiredFrames: 5 // Require 5 consecutive frames to avoid false positives
  });
  const vadCalibrationRef = useRef<{
    baselineNoise: number;
    adaptiveThreshold: number;
    noiseHistory: number[];
    speechHistory: number[];
    calibrationComplete: boolean;
  }>({
    baselineNoise: 0,
    adaptiveThreshold: 0.001,
    noiseHistory: [],
    speechHistory: [],
    calibrationComplete: false
  });
  
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
  const keepaliveIntervalRef = useRef<number | null>(null);
  const lastActivityRef = useRef<number>(Date.now());
  const reconnectTimeoutRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef<number>(0);
  const maxReconnectAttempts = 5;
  
  const SAMPLE_RATE = 16000;

  // Derived states
  const isListening = audioState === 'listening';
  const isProcessing = audioState === 'processing';
  const isSpeaking = audioState === 'speaking';
  
  // Pipeline event tracking
  const addPipelineEvent = useCallback((type: PipelineEvent['type'], data?: any, duration?: number) => {
    const event: PipelineEvent = {
      id: Math.random().toString(36).substr(2, 9),
      type,
      timestamp: Date.now(),
      data,
      duration
    };
    
    setPipelineEvents(prev => {
      const newEvents = [...prev, event];
      // Keep only last 50 events to prevent memory buildup
      if (newEvents.length > 50) {
        return newEvents.slice(-50);
      }
      return newEvents;
    });
    
    console.log(`Pipeline Event: ${type}`, data);
  }, []);
  
  // Update audio metrics
  const updateAudioMetrics = useCallback((
    rms: number, 
    maxAmplitude: number, 
    vadDetected: boolean,
    bufferSize: number = 0,
    bufferDuration: number = 0,
    vadThreshold?: number,
    baselineNoise?: number,
    calibrated?: boolean
  ) => {
    setAudioMetrics({
      rms,
      maxAmplitude,
      vadDetected,
      audioState,
      connectionId: connectionIdRef.current,
      bufferSize,
      bufferDuration,
      sampleRate: audioContextRef.current?.sampleRate || 48000,
      timestamp: Date.now(),
      vadThreshold,
      baselineNoise,
      calibrated
    });
  }, [audioState]);

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
        addPipelineEvent('playback_end');
        URL.revokeObjectURL(audioUrl);
        audioPlayerRef.current = null;
        
        // Reset processing sequence and TTS interruption state
        isProcessingSequenceRef.current = false;
        ttsInterruptionRef.current.speechDetectedDuringTTS = false;
        ttsInterruptionRef.current.consecutiveSpeechFrames = 0;
        
        // Resume listening after TTS finishes (if not manually paused)
        if (!isPausedRef.current) {
          setAudioStateDebounced('listening');
        }
      };
      
      audio.onerror = (err) => {
        console.error('Audio playback error:', err);
        URL.revokeObjectURL(audioUrl);
        audioPlayerRef.current = null;
        
        // Reset processing sequence and TTS interruption state
        isProcessingSequenceRef.current = false;
        ttsInterruptionRef.current.speechDetectedDuringTTS = false;
        ttsInterruptionRef.current.consecutiveSpeechFrames = 0;
        
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
            
            // Start client-side keepalive
            startKeepalive();
          } 
          else if (data.type === 'keepalive') {
            console.log(`Instance ${instanceIdRef.current}: Received keepalive ping`);
            lastActivityRef.current = Date.now();
            // No need to respond - server keepalive is one-way
          }
          else if (data.type === 'tts_progress') {
            console.log(`Instance ${instanceIdRef.current}: TTS progress:`, data.message);
            // Update activity to prevent timeout
            lastActivityRef.current = Date.now();
          } 
          else if (data.type === 'transcription_start') {
            console.log(`Instance ${instanceIdRef.current}: Transcription started`);
            addPipelineEvent('transcription_start', {
              duration: data.duration,
              audioSize: data.audio_size
            });
          }
          else if (data.type === 'transcription_response') {
            if (data.success && data.text && data.text !== lastTranscriptRef.current) {
              // Prevent processing duplicate transcriptions
              if (isProcessingSequenceRef.current) {
                console.log('Skipping transcription - already processing sequence');
                return;
              }
              
              console.log('Transcription received:', data.text);
              addPipelineEvent('transcription_end', { 
                text: data.text, 
                confidence: data.confidence 
              });
              
              lastTranscriptRef.current = data.text;
              setCurrentTranscript(data.text);
              setAudioStateWithLog('processing');
              
              // Mark sequence as processing
              isProcessingSequenceRef.current = true;
              
              // Add LLM start event
              addPipelineEvent('llm_start', { message: data.text });
              
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
              addPipelineEvent('llm_end', { 
                message: data.message, 
                model: data.model_used,
                tokens: data.tokens_used 
              });
              
              lastResponseRef.current = data.message;
              setCurrentResponse(data.message);
              
              // Add TTS start event
              addPipelineEvent('tts_start', { text: data.message });
              
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
              addPipelineEvent('tts_end', { 
                duration: data.duration_ms,
                voice: data.voice_used,
                audioSize: data.audio_data.length 
              });
              addPipelineEvent('playback_start');
              setAudioStateWithLog('speaking');
              playTTSAudio(data.audio_data);
            } else if (data.timeout) {
              // TTS timed out, show text response and resume listening
              console.warn(`Instance ${instanceIdRef.current}: TTS timed out, showing text response`);
              addPipelineEvent('tts_end', { error: 'timeout' });
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
              addPipelineEvent('tts_end', { error: data.error });
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
        
        // Stop keepalive on disconnect
        stopKeepalive();
        
        // Handle different disconnect reasons
        if (event.code === 1000) {
          // Normal closure - don't reconnect
          console.log(`Instance ${instanceIdRef.current}: Normal WebSocket closure`);
        } else if (event.code === 1011) {
          // Server error (keepalive timeout) - attempt reconnection
          console.log(`Instance ${instanceIdRef.current}: Server keepalive timeout - attempting reconnection`);
          attemptReconnection();
        } else if (event.code === 1012) {
          setError('Service restarting...');
          attemptReconnection();
        } else if (event.code === 1006) {
          setError('Connection failed - attempting reconnection...');
          attemptReconnection();
        } else {
          setError('Connection lost - attempting reconnection...');
          attemptReconnection();
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
            
            // Calculate audio metrics
            const rms = Math.sqrt(inputData.reduce((sum, sample) => sum + sample * sample, 0) / inputData.length);
            const maxAmplitude = Math.max(...inputData.map(Math.abs));
            
            // Adaptive VAD with noise calibration
            const vadCalibration = vadCalibrationRef.current;
            
            // Update noise baseline during silence periods
            if (!lastVadStateRef.current) {
              vadCalibration.noiseHistory.push(maxAmplitude);
              if (vadCalibration.noiseHistory.length > 50) {
                vadCalibration.noiseHistory = vadCalibration.noiseHistory.slice(-50);
                // Calculate baseline as 75th percentile of noise
                const sortedNoise = [...vadCalibration.noiseHistory].sort((a, b) => a - b);
                vadCalibration.baselineNoise = sortedNoise[Math.floor(sortedNoise.length * 0.75)];
              }
            }
            
            // Update speech levels during speech periods
            if (lastVadStateRef.current) {
              vadCalibration.speechHistory.push(maxAmplitude);
              if (vadCalibration.speechHistory.length > 20) {
                vadCalibration.speechHistory = vadCalibration.speechHistory.slice(-20);
              }
            }
            
            // Calculate adaptive threshold with much higher sensitivity requirements
            if (vadCalibration.noiseHistory.length > 10) {
              const noiseFloor = vadCalibration.baselineNoise;
              // Use much higher multiplier for stricter VAD - require 10x to 20x above noise floor
              const dynamicMultiplier = Math.max(10.0, Math.min(20.0, 15.0 + (noiseFloor * 2000)));
              vadCalibration.adaptiveThreshold = Math.max(0.005, noiseFloor * dynamicMultiplier); // Higher minimum threshold
              vadCalibration.calibrationComplete = true;
              
              console.log(`VAD Calibration: noise=${noiseFloor.toFixed(6)}, threshold=${vadCalibration.adaptiveThreshold.toFixed(6)}, multiplier=${dynamicMultiplier.toFixed(1)}`);
            }
            
            // Use different thresholds based on audio state
            let vadThreshold = vadCalibration.adaptiveThreshold;
            
            // Additional validation: require both amplitude AND RMS to be significant
            const amplitudeCheck = maxAmplitude > vadThreshold;
            const rmsCheck = rms > (vadThreshold * 0.3); // RMS should also be elevated
            const consistencyCheck = maxAmplitude > (rms * 2); // Amplitude should be reasonably higher than RMS
            
            // Only detect speech if ALL conditions are met
            let vadDetected = amplitudeCheck && rmsCheck && consistencyCheck;
            
            // Log detailed VAD analysis for debugging
            if (Date.now() % 2000 < 50) { // Every ~2 seconds
              console.log(`VAD Analysis: amp=${maxAmplitude.toFixed(6)} (>${vadThreshold.toFixed(6)}=${amplitudeCheck}), rms=${rms.toFixed(6)} (>${(vadThreshold*0.3).toFixed(6)}=${rmsCheck}), consistency=${consistencyCheck}, final=${vadDetected}`);
            }
            
            // TTS Interruption Detection
            const ttsInterruption = ttsInterruptionRef.current;
            if (audioState === 'speaking' && ttsInterruption.enabled) {
              // Use higher threshold during TTS to avoid false interruptions
              const ttsThreshold = Math.max(vadThreshold, ttsInterruption.interruptionThreshold);
              const speechDuringTTS = maxAmplitude > ttsThreshold;
              
              if (speechDuringTTS) {
                ttsInterruption.consecutiveSpeechFrames++;
                if (ttsInterruption.consecutiveSpeechFrames >= ttsInterruption.requiredFrames) {
                  if (!ttsInterruption.speechDetectedDuringTTS) {
                    console.log('🛑 TTS INTERRUPTION DETECTED - User speaking during TTS');
                    addPipelineEvent('tts_interruption', {
                      threshold: ttsThreshold,
                      amplitude: maxAmplitude,
                      consecutiveFrames: ttsInterruption.consecutiveSpeechFrames
                    });
                    
                    // Stop TTS playback immediately
                    if (audioPlayerRef.current) {
                      audioPlayerRef.current.pause();
                      audioPlayerRef.current = null;
                      addPipelineEvent('playback_interrupted');
                    }
                    
                    // Reset processing sequence and return to listening
                    isProcessingSequenceRef.current = false;
                    setAudioStateWithLog('listening');
                    
                    ttsInterruption.speechDetectedDuringTTS = true;
                  }
                }
              } else {
                ttsInterruption.consecutiveSpeechFrames = 0;
              }
              
              // Override VAD detection during TTS to show interruption status
              vadDetected = speechDuringTTS;
            } else {
              // Reset TTS interruption state when not speaking
              ttsInterruption.speechDetectedDuringTTS = false;
              ttsInterruption.consecutiveSpeechFrames = 0;
            }
            
            // Add calibration info to metrics
            const calibrationInfo = {
              threshold: vadThreshold,
              baselineNoise: vadCalibration.baselineNoise,
              calibrated: vadCalibration.calibrationComplete,
              noiseFloor: vadCalibration.baselineNoise
            };
            
            // Update real-time metrics with calibration info
            updateAudioMetrics(
              rms, 
              maxAmplitude, 
              vadDetected, 
              inputData.length * 2, 
              (inputData.length / audioContext.sampleRate) * 1000,
              vadThreshold,
              vadCalibration.baselineNoise,
              vadCalibration.calibrationComplete
            );
            
            // Log calibration status periodically
            if (Date.now() % 5000 < 50) { // Every ~5 seconds
              console.log(`VAD Calibration Status:`, {
                threshold: vadThreshold.toFixed(6),
                baselineNoise: vadCalibration.baselineNoise.toFixed(6),
                calibrated: vadCalibration.calibrationComplete,
                noiseHistorySize: vadCalibration.noiseHistory.length,
                speechHistorySize: vadCalibration.speechHistory.length
              });
            }
            
            // Only log audio capture events for actual speech detection
            if (vadDetected) {
              addPipelineEvent('audio_capture', { 
                rms: rms.toFixed(6), 
                maxAmplitude: maxAmplitude.toFixed(6), 
                vadDetected,
                threshold: vadThreshold.toFixed(6),
                amplitudeCheck,
                rmsCheck,
                consistencyCheck
              });
              
              // Add VAD trigger event for first speech detection
              if (!lastVadStateRef.current) {
                console.log('🎤 REAL SPEECH DETECTED - Starting audio capture');
                addPipelineEvent('vad_trigger', { 
                  threshold: vadThreshold,
                  confidence: maxAmplitude / vadThreshold
                });
              }
            }
            
            // Track VAD sessions and patterns
            const currentTime = Date.now();
            
            if (vadDetected && !lastVadStateRef.current) {
              // Speech started
              vadSessionRef.current.startTime = currentTime;
              addPipelineEvent('vad_trigger', { 
                threshold: vadThreshold,
                rms,
                maxAmplitude,
                transitionType: 'silence_to_speech'
              });
            } else if (!vadDetected && lastVadStateRef.current && vadSessionRef.current.startTime) {
              // Speech ended
              const speechDuration = currentTime - vadSessionRef.current.startTime;
              vadSessionRef.current.speechDuration = speechDuration;
              addPipelineEvent('vad_trigger', { 
                threshold: vadThreshold,
                speechDuration,
                transitionType: 'speech_to_silence'
              });
            }
            
            // Track VAD state changes
            lastVadStateRef.current = vadDetected;
            
            console.log(`Instance ${instanceIdRef.current}: Audio Input - RMS: ${rms.toFixed(4)}, Max: ${maxAmplitude.toFixed(4)}, VAD: ${vadDetected ? 'SPEECH' : 'SILENCE'}, Length: ${inputData.length}`);
            
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
  
  const startKeepalive = useCallback(() => {
    // Clear any existing keepalive
    if (keepaliveIntervalRef.current) {
      clearInterval(keepaliveIntervalRef.current);
    }
    
    // Send ping every 30 seconds
    keepaliveIntervalRef.current = window.setInterval(() => {
      if (websocketRef.current?.readyState === WebSocket.OPEN) {
        console.log(`Instance ${instanceIdRef.current}: Sending client keepalive ping`);
        websocketRef.current.send('ping');
        lastActivityRef.current = Date.now();
      }
    }, 30000);
  }, []);
  
  const stopKeepalive = useCallback(() => {
    if (keepaliveIntervalRef.current) {
      clearInterval(keepaliveIntervalRef.current);
      keepaliveIntervalRef.current = null;
    }
  }, []);
  
  const stopListening = useCallback(() => {
    isPausedRef.current = true;
    
    // Reset processing sequence
    isProcessingSequenceRef.current = false;
    
    // Clear debounce timeout
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
      debounceTimeoutRef.current = null;
    }
    
    // Stop keepalive
    stopKeepalive();
    
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
  
  const attemptReconnection = useCallback(() => {
    if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
      setError(`Connection failed after ${maxReconnectAttempts} attempts. Please refresh the page.`);
      return;
    }
    
    // Clear any existing reconnection timeout
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    
    const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000); // Exponential backoff, max 30s
    reconnectAttemptsRef.current++;
    
    console.log(`Instance ${instanceIdRef.current}: Attempting reconnection ${reconnectAttemptsRef.current}/${maxReconnectAttempts} in ${delay}ms`);
    setError(`Reconnecting... (${reconnectAttemptsRef.current}/${maxReconnectAttempts})`);
    
    reconnectTimeoutRef.current = window.setTimeout(async () => {
      try {
        await initializeWebSocket();
        // Reset reconnect attempts on successful connection
        reconnectAttemptsRef.current = 0;
        setError(null);
        console.log(`Instance ${instanceIdRef.current}: Reconnection successful`);
      } catch (error) {
        console.error(`Instance ${instanceIdRef.current}: Reconnection failed:`, error);
        attemptReconnection(); // Try again
      }
    }, delay);
  }, [initializeWebSocket]);
  
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
    resumeListening,
    audioMetrics,
    pipelineEvents,
    addPipelineEvent
  };
};