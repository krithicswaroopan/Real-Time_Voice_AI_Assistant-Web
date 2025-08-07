import { useState, useRef, useEffect, useCallback } from 'react';

interface UseContinuousAudioReturn {
  isListening: boolean;
  isProcessing: boolean;
  currentTranscript: string;
  error: string | null;
  startListening: () => Promise<void>;
  stopListening: () => void;
}

export const useContinuousAudio = (): UseContinuousAudioReturn => {
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentTranscript, setCurrentTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const websocketRef = useRef<WebSocket | null>(null);
  const connectionIdRef = useRef<string | null>(null);
  const isConnectedRef = useRef<boolean>(false);
  
  const CHUNK_SIZE = 1024; // Audio chunk size for streaming
  const SAMPLE_RATE = 16000; // 16kHz sample rate for VAD
  
  const initializeWebSocket = useCallback(async () => {
    // Only initialize once
    if (websocketRef.current && isConnectedRef.current) {
      return;
    }
    
    // Clean up existing connection
    if (websocketRef.current) {
      websocketRef.current.close();
    }
    
    console.log('Initializing WebSocket connection...');
    
    try {
      const ws = new WebSocket('ws://localhost:8000/api/v1/streaming/ws');
      
      ws.onopen = () => {
        console.log('WebSocket connected for continuous audio');
        isConnectedRef.current = true;
        setError(null);
      };
    
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'connection_established') {
            console.log('Connection established with ID:', data.connection_id);
            connectionIdRef.current = data.connection_id;
          } else if (data.type === 'transcription_response') {
            if (data.success && data.text) {
              setCurrentTranscript(data.text);
              setIsProcessing(false);
              
              // Send chat request immediately after transcription
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                  type: 'chat_request',
                  message: data.text
                }));
              }
            }
          } else if (data.type === 'chat_response') {
            if (data.success && data.message) {
              // Request TTS for the response
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                  type: 'tts_request',
                  text: data.message
                }));
              }
            }
          } else if (data.type === 'error') {
            console.error('WebSocket error from server:', data.message);
            setError(data.message);
          }
        } catch (err) {
          console.error('WebSocket message error:', err);
        }
      };
    
      ws.onerror = (event) => {
        console.error('WebSocket error:', event);
        isConnectedRef.current = false;
        setError('WebSocket connection error');
      };
      
      ws.onclose = (event) => {
        console.log(`WebSocket disconnected: ${event.code} - ${event.reason}`);
        isConnectedRef.current = false;
        
        // Handle different close codes
        if (event.code === 1012) {
          console.log('Service restart detected');
          setError('Service restarting...');
        } else if (event.code === 1006) {
          console.log('Connection failed');
          setError('Connection failed');
        } else if (event.code === 1001) {
          console.log('Page refreshed or navigated away');
          setError('Connection closed');
        } else if (event.code !== 1000) {
          console.log('Unexpected disconnection');
          setError('Connection lost');
        }
      };
      
      websocketRef.current = ws;
    } catch (error) {
      console.error('Failed to create WebSocket:', error);
      setError('Failed to create WebSocket connection');
    }
  }, []);

  
  const startListening = useCallback(async () => {
    try {
      setError(null);
      
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: SAMPLE_RATE,
          sampleSize: 16,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });
      
      streamRef.current = stream;
      
      // Initialize audio context
      const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
      audioContextRef.current = audioContext;
      
      // Create MediaRecorder for continuous recording
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });
      
      mediaRecorderRef.current = mediaRecorder;
      
      // Initialize WebSocket
      await initializeWebSocket();
      
      // Handle audio data
      mediaRecorder.ondataavailable = async (event) => {
        if (event.data.size > 0 && websocketRef.current?.readyState === WebSocket.OPEN) {
          try {
            // Convert to ArrayBuffer
            const arrayBuffer = await event.data.arrayBuffer();
            const audioData = new Uint8Array(arrayBuffer);
            
            // Send audio chunk to backend for VAD processing
            websocketRef.current.send(JSON.stringify({
              type: 'audio_chunk',
              audio_data: Array.from(audioData),
              format: 'webm'
            }));
          } catch (err) {
            console.error('Error processing audio chunk:', err);
            // If WebSocket is closed, log the error
            if (websocketRef.current?.readyState === WebSocket.CLOSED) {
              console.error('WebSocket connection is closed, cannot send audio data');
              setError('Connection lost');
            }
          }
        }
      };
      
      // Start recording with small chunks for real-time processing
      mediaRecorder.start(100); // 100ms chunks
      setIsListening(true);
      
    } catch (err) {
      console.error('Error starting continuous listening:', err);
      setError('Failed to start listening');
    }
  }, [initializeWebSocket]);
  
  const stopListening = useCallback(() => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    
    if (websocketRef.current) {
      websocketRef.current.close(1000, 'User stopped listening');
      websocketRef.current = null;
    }
    
    isConnectedRef.current = false;
    connectionIdRef.current = null;
    
    setIsListening(false);
    setIsProcessing(false);
    setCurrentTranscript('');
    setError(null);
  }, []);
  
  // Auto-start listening when component mounts
  useEffect(() => {
    const initializeApp = async () => {
      await startListening();
    };
    
    initializeApp();
    
    return () => {
      stopListening();
    };
  }, [startListening, stopListening]);
  
  // Handle speech detection timeout
  useEffect(() => {
    let timeoutId: number;
    
    if (currentTranscript) {
      setIsProcessing(true);
      
      // Wait for silence before processing transcript
      timeoutId = window.setTimeout(() => {
        if (websocketRef.current?.readyState === WebSocket.OPEN) {
          websocketRef.current.send(JSON.stringify({
            type: 'transcription_request',
            language: 'en'
          }));
        }
      }, 1000); // 1 second silence timeout
    }
    
    return () => {
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [currentTranscript]);
  
  return {
    isListening,
    isProcessing,
    currentTranscript,
    error,
    startListening,
    stopListening
  };
};