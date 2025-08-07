import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Typography, Paper } from '@mui/material';
import { motion, AnimatePresence } from 'framer-motion';

interface ResponseDisplayProps {
  response: string;
  isVisible: boolean;
  onTTSComplete: () => void;
}

const ResponseDisplay: React.FC<ResponseDisplayProps> = ({ 
  response, 
  isVisible, 
  onTTSComplete 
}) => {
  const [displayText, setDisplayText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [showResponse, setShowResponse] = useState(false);
  const [fadeTimeout, setFadeTimeout] = useState<number | null>(null);
  
  // Use refs to track ongoing operations
  const typingTimeoutRef = useRef<number | null>(null);
  const isTypingCancelledRef = useRef(false);
  const lastResponseRef = useRef('');
  
  const TYPING_SPEED = 50; // ms per character
  const FADE_DELAY = 20000; // 20 seconds
  
  const cancelTyping = useCallback(() => {
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    isTypingCancelledRef.current = true;
  }, []);
  
  const typeText = useCallback(async (text: string) => {
    // Cancel any ongoing typing
    cancelTyping();
    
    setIsTyping(true);
    setDisplayText('');
    isTypingCancelledRef.current = false;
    
    for (let i = 0; i <= text.length; i++) {
      // Check if typing was cancelled
      if (isTypingCancelledRef.current) {
        return;
      }
      
      setDisplayText(text.substring(0, i));
      
      // Use ref to track timeout and allow cancellation
      await new Promise<void>((resolve) => {
        typingTimeoutRef.current = window.setTimeout(() => {
          typingTimeoutRef.current = null;
          resolve();
        }, TYPING_SPEED);
      });
    }
    
    if (!isTypingCancelledRef.current) {
      setIsTyping(false);
      onTTSComplete(); // Notify that typing is complete for TTS
    }
  }, [onTTSComplete, cancelTyping]);
  
  const fadeTimeoutRef = useRef<number | null>(null);
  
  const startFadeTimer = useCallback(() => {
    if (fadeTimeoutRef.current) {
      window.clearTimeout(fadeTimeoutRef.current);
    }
    
    const timeout = window.setTimeout(() => {
      setShowResponse(false);
      setDisplayText('');
      fadeTimeoutRef.current = null;
    }, FADE_DELAY);
    
    fadeTimeoutRef.current = timeout;
    setFadeTimeout(timeout);
  }, []);
  
  useEffect(() => {
    // Only start typing if this is a new response
    if (response && isVisible && response !== lastResponseRef.current) {
      lastResponseRef.current = response;
      setShowResponse(true);
      typeText(response);
    }
  }, [response, isVisible, typeText]);
  
  useEffect(() => {
    if (!isTyping && displayText) {
      startFadeTimer();
    }
  }, [isTyping, displayText, startFadeTimer]);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelTyping();
      if (fadeTimeoutRef.current) {
        window.clearTimeout(fadeTimeoutRef.current);
        fadeTimeoutRef.current = null;
      }
    };
  }, [cancelTyping]);
  
  return (
    <AnimatePresence>
      {showResponse && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.5 }}
        >
          <Paper
            elevation={3}
            sx={{
              p: 3,
              mb: 3,
              maxWidth: '80%',
              mx: 'auto',
              background: 'rgba(26, 26, 26, 0.9)',
              backdropFilter: 'blur(10px)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: 3,
            }}
          >
            <Typography
              variant="h6"
              sx={{
                color: 'white',
                fontWeight: 400,
                lineHeight: 1.6,
                textAlign: 'center',
                minHeight: '2rem',
              }}
            >
              {displayText}
              {isTyping && (
                <motion.span
                  animate={{ opacity: [0, 1, 0] }}
                  transition={{ duration: 0.8, repeat: Infinity }}
                  style={{ color: 'primary.main' }}
                >
                  |
                </motion.span>
              )}
            </Typography>
          </Paper>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default ResponseDisplay;