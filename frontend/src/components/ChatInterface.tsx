import React, { useState, useRef, useEffect } from 'react';
import {
  Box,
  Typography,
  Alert,
} from '@mui/material';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';

import { useAudioManager } from '../hooks/useAudioManager.ts';
import LiveAudioVisualizer from './LiveAudioVisualizer.tsx';
import ResponseDisplay from './ResponseDisplay.tsx';
import AudioDebugPanel from './AudioDebugPanel.tsx';


interface VoiceSession {
  transcription: string;
  response: string;
  timestamp: Date;
  isComplete: boolean;
}

const ChatInterface: React.FC = () => {
  const [showResponse, setShowResponse] = useState(false);
  const [hasVoiceActivity, setHasVoiceActivity] = useState(false);
  const [isTTSComplete, setIsTTSComplete] = useState(false);
  const [voiceSessions, setVoiceSessions] = useState<VoiceSession[]>([]);
  const [debugPanelVisible, setDebugPanelVisible] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // Track last processed response to prevent duplicates
  const lastProcessedResponseRef = useRef('');

  // Unified audio management hook
  const {
    audioState,
    isListening,
    isProcessing,
    isSpeaking,
    currentTranscript,
    currentResponse: audioResponse,
    error: audioError,
    audioMetrics,
    pipelineEvents,
    addPipelineEvent
  } = useAudioManager();

  // Auto-scroll to bottom when new sessions arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [voiceSessions]);

  // Handle voice activity detection
  useEffect(() => {
    setHasVoiceActivity(Boolean(currentTranscript));
  }, [currentTranscript]);

  // Handle voice sessions from audio manager
  useEffect(() => {
    if (audioResponse && currentTranscript && audioResponse !== lastProcessedResponseRef.current) {
      // Update the last processed response
      lastProcessedResponseRef.current = audioResponse;
      
      const session: VoiceSession = {
        transcription: currentTranscript,
        response: audioResponse,
        timestamp: new Date(),
        isComplete: audioState === 'speaking' || audioState === 'processing'
      };
      
      setVoiceSessions(prev => {
        // More robust duplicate detection
        const isDuplicate = prev.some(existingSession => 
          existingSession.transcription === session.transcription && 
          existingSession.response === session.response &&
          Math.abs(existingSession.timestamp.getTime() - session.timestamp.getTime()) < 1000 // Within 1 second
        );
        
        if (isDuplicate) {
          return prev;
        }
        return [...prev, session];
      });
      
      setShowResponse(true);
    }
  }, [audioResponse, currentTranscript, audioState]);

  // Update TTS completion based on audio state
  useEffect(() => {
    if (audioState === 'listening' && isTTSComplete !== true) {
      setIsTTSComplete(true);
    } else if (audioState === 'speaking') {
      setIsTTSComplete(false);
    }
  }, [audioState, isTTSComplete]);


  // Handle errors
  useEffect(() => {
    if (audioError) {
      toast.error(audioError);
    }
  }, [audioError]);

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Live Audio Visualizer */}
      <LiveAudioVisualizer
        isListening={isListening}
        isProcessing={isProcessing}
        isSpeaking={isSpeaking}
        hasVoiceActivity={hasVoiceActivity}
        currentTranscript={currentTranscript}
        error={audioError}
      />

      {/* Main Content Area */}
      <Box
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          p: 3,
          background: 'linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 100%)',
          minHeight: '100vh',
        }}
      >
        {/* Error Alert */}
        {audioError && (
          <Alert severity="error" sx={{ mb: 3, maxWidth: 500 }}>
            {audioError}
          </Alert>
        )}

        {/* Welcome Message */}
        {!audioResponse && !isProcessing && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
          >
            <Typography
              variant="h3"
              sx={{
                textAlign: 'center',
                mb: 2,
                fontWeight: 300,
                background: 'linear-gradient(45deg, #667eea, #764ba2)',
                backgroundClip: 'text',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              Voice AI Assistant
            </Typography>
            <Typography
              variant="h6"
              sx={{
                textAlign: 'center',
                color: 'text.secondary',
                fontWeight: 300,
                maxWidth: 600,
              }}
            >
              {isListening ? 'Listening... Speak naturally and I\'ll respond' : 'Initializing voice recognition...'}
            </Typography>
          </motion.div>
        )}

        {/* Response Display */}
        <ResponseDisplay
          response={audioResponse}
          isVisible={showResponse}
          onTTSComplete={() => {}} // TTS is now handled by audio manager
        />

        {/* Voice Sessions History (Hidden but tracked) */}
        <Box sx={{ display: 'none' }}>
          {voiceSessions.map((session, index) => (
            <Box key={index}>
              <Typography variant="caption">
                {session.transcription} → {session.response}
              </Typography>
            </Box>
          ))}
        </Box>

        <div ref={messagesEndRef} />
      </Box>

      {/* Debug Panel */}
      <AudioDebugPanel
        isVisible={debugPanelVisible}
        onToggle={setDebugPanelVisible}
        audioMetrics={audioMetrics}
        pipelineEvents={pipelineEvents}
      />
    </Box>
  );
};

export default ChatInterface;