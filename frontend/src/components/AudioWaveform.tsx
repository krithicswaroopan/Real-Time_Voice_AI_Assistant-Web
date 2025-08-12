import React, { useRef, useEffect } from 'react';
import { Box } from '@mui/material';

interface AudioWaveformProps {
  audioMetrics: {
    rms: number;
    maxAmplitude: number;
    vadDetected: boolean;
  } | null;
  width?: number;
  height?: number;
}

const AudioWaveform: React.FC<AudioWaveformProps> = ({ 
  audioMetrics, 
  width = 300, 
  height = 60 
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const waveformData = useRef<number[]>([]);
  const animationFrameRef = useRef<number>();

  useEffect(() => {
    if (!audioMetrics) return;

    // Add current audio level to waveform data
    waveformData.current.push(audioMetrics.maxAmplitude * 100);
    
    // Keep only last 100 data points
    if (waveformData.current.length > 100) {
      waveformData.current = waveformData.current.slice(-100);
    }

    // Draw waveform
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Set canvas size
    canvas.width = width;
    canvas.height = height;

    // Draw background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
    ctx.fillRect(0, 0, width, height);

    // Draw center line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    // Draw waveform
    if (waveformData.current.length > 1) {
      const barWidth = width / waveformData.current.length;
      
      waveformData.current.forEach((amplitude, index) => {
        const x = index * barWidth;
        const barHeight = (amplitude / 100) * (height / 2);
        
        // Color based on VAD detection
        const color = audioMetrics.vadDetected 
          ? `rgba(76, 175, 80, ${0.3 + amplitude / 100 * 0.7})` // Green for speech
          : `rgba(117, 117, 117, ${0.3 + amplitude / 100 * 0.7})`; // Gray for silence
        
        ctx.fillStyle = color;
        
        // Draw bar from center
        ctx.fillRect(x, (height / 2) - barHeight, barWidth - 1, barHeight * 2);
      });
    }

    // Draw current RMS level indicator
    if (audioMetrics.rms > 0) {
      const rmsHeight = (audioMetrics.rms * 1000) * (height / 2);
      ctx.strokeStyle = audioMetrics.vadDetected ? '#4caf50' : '#ff9800';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(width - 2, (height / 2) - rmsHeight);
      ctx.lineTo(width - 2, (height / 2) + rmsHeight);
      ctx.stroke();
    }

  }, [audioMetrics, width, height]);

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', mb: 1 }}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: 4,
          backgroundColor: 'rgba(0, 0, 0, 0.3)'
        }}
      />
    </Box>
  );
};

export default AudioWaveform;