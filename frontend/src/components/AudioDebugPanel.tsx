import React, { useState, useEffect } from 'react';
import { 
  Paper, 
  Typography, 
  Box, 
  Chip, 
  LinearProgress,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Switch,
  FormControlLabel
} from '@mui/material';
import { ExpandMore as ExpandMoreIcon } from '@mui/icons-material';
import { motion } from 'framer-motion';
import AudioWaveform from './AudioWaveform.tsx';

interface AudioMetrics {
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

interface PipelineEvent {
  id: string;
  type: 'audio_capture' | 'vad_trigger' | 'transcription_start' | 'transcription_end' | 'llm_start' | 'llm_end' | 'tts_start' | 'tts_end' | 'playback_start' | 'playback_end' | 'tts_interruption' | 'playback_interrupted';
  timestamp: number;
  data?: any;
  duration?: number;
}

interface AudioDebugPanelProps {
  isVisible: boolean;
  onToggle: (visible: boolean) => void;
  audioMetrics: AudioMetrics | null;
  pipelineEvents: PipelineEvent[];
}

const AudioDebugPanel: React.FC<AudioDebugPanelProps> = ({
  isVisible,
  onToggle,
  audioMetrics,
  pipelineEvents
}) => {
  const [expanded, setExpanded] = useState<string | false>('metrics');

  const getStateColor = (state: string) => {
    switch (state) {
      case 'listening': return '#4caf50'; // Green
      case 'processing': return '#ff9800'; // Orange  
      case 'speaking': return '#f44336'; // Red
      default: return '#757575'; // Grey
    }
  };

  const getVADColor = (detected: boolean) => {
    return detected ? '#4caf50' : '#757575';
  };

  const formatDuration = (ms: number) => {
    return `${ms.toFixed(0)}ms`;
  };

  const formatTimestamp = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    if (diff < 1000) return `${diff}ms ago`;
    return `${(diff / 1000).toFixed(1)}s ago`;
  };

  const getLatestPipelineDelay = () => {
    if (pipelineEvents.length < 2) return 0;
    const latest = pipelineEvents.slice(-2);
    return latest[1].timestamp - latest[0].timestamp;
  };

  if (!isVisible) {
    return (
      <Box
        sx={{
          position: 'fixed',
          top: 20,
          right: 20,
          zIndex: 9999,
        }}
      >
        <FormControlLabel
          control={
            <Switch
              checked={isVisible}
              onChange={(e) => onToggle(e.target.checked)}
              size="small"
            />
          }
          label={
            <Typography variant="caption" sx={{ color: 'white', fontSize: '0.7rem' }}>
              Debug
            </Typography>
          }
        />
      </Box>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 300 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 300 }}
      transition={{ duration: 0.3 }}
      style={{
        position: 'fixed',
        top: 20,
        right: 20,
        width: 400,
        maxHeight: '80vh',
        overflowY: 'auto',
        zIndex: 9999,
      }}
    >
      <Paper
        elevation={8}
        sx={{
          p: 2,
          background: 'rgba(26, 26, 26, 0.95)',
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: 2,
        }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6" sx={{ color: 'white', fontSize: '1rem' }}>
            🔊 Audio Debug
          </Typography>
          <Switch
            checked={isVisible}
            onChange={(e) => onToggle(e.target.checked)}
            size="small"
          />
        </Box>

        {/* Real-time Metrics */}
        <Accordion 
          expanded={expanded === 'metrics'} 
          onChange={() => setExpanded(expanded === 'metrics' ? false : 'metrics')}
          sx={{ mb: 1, bgcolor: 'rgba(255, 255, 255, 0.05)' }}
        >
          <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: 'white' }} />}>
            <Typography sx={{ color: 'white', fontSize: '0.9rem' }}>
              📊 Real-time Metrics
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            {audioMetrics ? (
              <Box sx={{ space: 1 }}>
                {/* Audio State */}
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                  <Typography variant="caption" sx={{ color: 'white' }}>State:</Typography>
                  <Chip
                    label={audioMetrics.audioState.toUpperCase()}
                    size="small"
                    sx={{
                      bgcolor: getStateColor(audioMetrics.audioState),
                      color: 'white',
                      fontSize: '0.7rem',
                      height: 20
                    }}
                  />
                </Box>

                {/* VAD Status */}
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                  <Typography variant="caption" sx={{ color: 'white' }}>VAD:</Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box
                      sx={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        bgcolor: getVADColor(audioMetrics.vadDetected),
                        animation: audioMetrics.vadDetected ? 'pulse 1s infinite' : 'none',
                      }}
                    />
                    <Typography variant="caption" sx={{ color: 'white', fontSize: '0.7rem' }}>
                      {audioMetrics.vadDetected ? 'SPEECH' : 'SILENCE'}
                    </Typography>
                  </Box>
                </Box>

                {/* Audio Levels */}
                <Box sx={{ mb: 1 }}>
                  <Typography variant="caption" sx={{ color: 'white', fontSize: '0.7rem' }}>
                    RMS: {audioMetrics.rms.toFixed(4)}
                  </Typography>
                  <LinearProgress
                    variant="determinate"
                    value={Math.min(audioMetrics.rms * 1000, 100)}
                    sx={{
                      mt: 0.5,
                      height: 4,
                      bgcolor: 'rgba(255, 255, 255, 0.1)',
                      '& .MuiLinearProgress-bar': {
                        bgcolor: audioMetrics.rms > 0.001 ? '#4caf50' : '#757575'
                      }
                    }}
                  />
                </Box>

                <Box sx={{ mb: 1 }}>
                  <Typography variant="caption" sx={{ color: 'white', fontSize: '0.7rem' }}>
                    Max: {audioMetrics.maxAmplitude.toFixed(4)}
                  </Typography>
                  <LinearProgress
                    variant="determinate"
                    value={Math.min(audioMetrics.maxAmplitude * 100, 100)}
                    sx={{
                      mt: 0.5,
                      height: 4,
                      bgcolor: 'rgba(255, 255, 255, 0.1)',
                      '& .MuiLinearProgress-bar': {
                        bgcolor: audioMetrics.maxAmplitude > 0.01 ? '#ff9800' : '#757575'
                      }
                    }}
                  />
                </Box>

                {/* Buffer Status */}
                <Typography variant="caption" sx={{ color: 'white', fontSize: '0.7rem' }}>
                  Buffer: {audioMetrics.bufferSize} bytes ({audioMetrics.bufferDuration.toFixed(1)}ms)
                </Typography>
                <br />
                <Typography variant="caption" sx={{ color: 'white', fontSize: '0.7rem' }}>
                  Rate: {audioMetrics.sampleRate}Hz
                </Typography>
                <br />
                
                {/* VAD Calibration Info */}
                {audioMetrics.vadThreshold !== undefined && (
                  <>
                    <Typography variant="caption" sx={{ color: 'white', fontSize: '0.7rem' }}>
                      VAD Threshold: {audioMetrics.vadThreshold.toFixed(6)}
                    </Typography>
                    <br />
                    <Typography variant="caption" sx={{ color: 'white', fontSize: '0.7rem' }}>
                      Noise Floor: {(audioMetrics.baselineNoise || 0).toFixed(6)}
                    </Typography>
                    <br />
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                      <Typography variant="caption" sx={{ color: 'white', fontSize: '0.7rem' }}>
                        Calibrated:
                      </Typography>
                      <Box
                        sx={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          bgcolor: audioMetrics.calibrated ? '#4caf50' : '#ff9800'
                        }}
                      />
                      <Typography variant="caption" sx={{ color: audioMetrics.calibrated ? '#4caf50' : '#ff9800', fontSize: '0.7rem' }}>
                        {audioMetrics.calibrated ? 'YES' : 'CALIBRATING...'}
                      </Typography>
                    </Box>
                  </>
                )}
                <Typography variant="caption" sx={{ color: '#999', fontSize: '0.6rem' }}>
                  Updated: {formatTimestamp(audioMetrics.timestamp)}
                </Typography>
                
                {/* Real-time Waveform */}
                <Box sx={{ mt: 2 }}>
                  <Typography variant="caption" sx={{ color: 'white', fontSize: '0.7rem', mb: 1, display: 'block' }}>
                    Live Waveform:
                  </Typography>
                  <AudioWaveform 
                    audioMetrics={{
                      rms: audioMetrics.rms,
                      maxAmplitude: audioMetrics.maxAmplitude,
                      vadDetected: audioMetrics.vadDetected
                    }} 
                    width={350} 
                    height={50} 
                  />
                </Box>
              </Box>
            ) : (
              <Typography variant="caption" sx={{ color: '#999' }}>
                No audio data available
              </Typography>
            )}
          </AccordionDetails>
        </Accordion>

        {/* Pipeline Timeline */}
        <Accordion 
          expanded={expanded === 'timeline'} 
          onChange={() => setExpanded(expanded === 'timeline' ? false : 'timeline')}
          sx={{ mb: 1, bgcolor: 'rgba(255, 255, 255, 0.05)' }}
        >
          <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: 'white' }} />}>
            <Typography sx={{ color: 'white', fontSize: '0.9rem' }}>
              ⏱️ Pipeline Timeline
            </Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ maxHeight: 200, overflowY: 'auto' }}>
            {pipelineEvents.length > 0 ? (
              <Box>
                <Typography variant="caption" sx={{ color: '#4caf50', mb: 1, display: 'block', fontSize: '0.7rem' }}>
                  Latest Delay: {formatDuration(getLatestPipelineDelay())}
                </Typography>
                {pipelineEvents.slice(-10).reverse().map((event, index) => {
                  const isInterruptionEvent = event.type === 'tts_interruption' || event.type === 'playback_interrupted';
                  return (
                  <Box key={event.id} sx={{ 
                    mb: 1, 
                    p: 1, 
                    bgcolor: isInterruptionEvent ? 'rgba(255, 87, 34, 0.1)' : 'rgba(255, 255, 255, 0.03)', 
                    border: isInterruptionEvent ? '1px solid rgba(255, 87, 34, 0.3)' : 'none',
                    borderRadius: 1 
                  }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Typography variant="caption" sx={{ 
                        color: isInterruptionEvent ? '#ff5722' : 'white', 
                        fontSize: '0.7rem',
                        fontWeight: isInterruptionEvent ? 'bold' : 'normal'
                      }}>
                        {isInterruptionEvent ? '🛑 ' : ''}{event.type.replace('_', ' ').toUpperCase()}
                      </Typography>
                      <Typography variant="caption" sx={{ color: '#999', fontSize: '0.6rem' }}>
                        {formatTimestamp(event.timestamp)}
                      </Typography>
                    </Box>
                    {event.duration && (
                      <Typography variant="caption" sx={{ color: '#ff9800', fontSize: '0.6rem' }}>
                        Duration: {formatDuration(event.duration)}
                      </Typography>
                    )}
                    {event.data && (
                      <Typography variant="caption" sx={{ color: '#999', fontSize: '0.6rem', display: 'block' }}>
                        {JSON.stringify(event.data).substring(0, 50)}...
                      </Typography>
                    )}
                  </Box>
                  );
                })}
              </Box>
            ) : (
              <Typography variant="caption" sx={{ color: '#999' }}>
                No pipeline events recorded
              </Typography>
            )}
          </AccordionDetails>
        </Accordion>

        {/* Connection Info */}
        <Box sx={{ mt: 1, p: 1, bgcolor: 'rgba(255, 255, 255, 0.03)', borderRadius: 1 }}>
          <Typography variant="caption" sx={{ color: 'white', fontSize: '0.7rem' }}>
            Connection: {audioMetrics?.connectionId || 'Not connected'}
          </Typography>
        </Box>

        <style jsx>{`
          @keyframes pulse {
            0% { opacity: 1; }
            50% { opacity: 0.5; }
            100% { opacity: 1; }
          }
        `}</style>
      </Paper>
    </motion.div>
  );
};

export default AudioDebugPanel;
export type { AudioMetrics, PipelineEvent };