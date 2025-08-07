"""Audio processing service for VAD, noise suppression, and audio pipeline."""

import logging
import numpy as np
import webrtcvad
import io
import wave
import tempfile
from typing import Optional, Tuple, List
try:
    from pydub import AudioSegment
    from pydub.utils import which
    PYDUB_AVAILABLE = True
except ImportError:
    PYDUB_AVAILABLE = False
    logger.warning("pydub not available - WebM conversion disabled")
from app.config import settings

logger = logging.getLogger(__name__)


class AudioService:
    """Audio processing service for VAD and noise suppression."""
    
    def __init__(self):
        """Initialize the audio service."""
        self.sample_rate = settings.sample_rate
        self.chunk_duration_ms = settings.chunk_duration_ms
        self.vad_mode = settings.vad_mode
        self.min_speech_duration_ms = settings.vad_min_speech_duration_ms
        self.speech_threshold = settings.vad_speech_threshold
        
        # Speech tracking for minimum duration
        self.speech_frames = []
        self.silence_frames = []
        
        # Adaptive VAD parameters
        self.noise_floor = 50.0  # Initial noise floor estimate
        self.noise_samples = []
        self.max_noise_samples = 100
        self.adaptive_threshold_multiplier = 2.5
        
        # Initialize VAD
        try:
            self.vad = webrtcvad.Vad(self.vad_mode)
            logger.info(f"VAD initialized with mode {self.vad_mode}, min speech duration: {self.min_speech_duration_ms}ms")
        except Exception as e:
            logger.error(f"Failed to initialize VAD: {str(e)}")
            self.vad = None

    def convert_webm_to_pcm(
        self,
        webm_data: bytes,
        target_sample_rate: Optional[int] = None
    ) -> Tuple[bytes, bool]:
        """
        Convert WebM audio data to PCM format.
        
        Args:
            webm_data: Raw WebM audio data from MediaRecorder
            target_sample_rate: Target sample rate (defaults to configured rate)
            
        Returns:
            Tuple of (pcm_data, success)
        """
        try:
            if not PYDUB_AVAILABLE:
                logger.error("pydub not available for WebM conversion")
                return b'', False
            
            target_sample_rate = target_sample_rate or self.sample_rate
            
            # Create a temporary file for WebM data
            with tempfile.NamedTemporaryFile(suffix='.webm', delete=False) as temp_file:
                temp_file.write(webm_data)
                temp_file.flush()
                
                try:
                    # Load WebM audio using pydub
                    audio = AudioSegment.from_file(temp_file.name, format="webm")
                    
                    # Convert to mono and target sample rate
                    audio = audio.set_channels(1).set_frame_rate(target_sample_rate)
                    
                    # Convert to 16-bit samples
                    audio = audio.set_sample_width(2)
                    
                    # Get raw PCM data
                    pcm_data = audio.raw_data
                    
                    logger.debug(f"Converted WebM ({len(webm_data)} bytes) to PCM ({len(pcm_data)} bytes)")
                    return pcm_data, True
                    
                except Exception as e:
                    logger.error(f"Error converting WebM to PCM: {str(e)}")
                    return b'', False
                finally:
                    # Clean up temporary file
                    try:
                        import os
                        os.unlink(temp_file.name)
                    except:
                        pass
                        
        except Exception as e:
            logger.error(f"WebM to PCM conversion failed: {str(e)}")
            return b'', False

    def convert_pcm_to_wav(
        self, 
        pcm_data: bytes, 
        sample_rate: Optional[int] = None,
        channels: int = 1,
        sample_width: int = 2
    ) -> bytes:
        """
        Convert raw PCM audio data to WAV format.
        
        Args:
            pcm_data: Raw PCM audio data
            sample_rate: Audio sample rate (defaults to configured rate)
            channels: Number of audio channels (default: 1 for mono)
            sample_width: Sample width in bytes (default: 2 for 16-bit)
            
        Returns:
            WAV-formatted audio data
        """
        try:
            sample_rate = sample_rate or self.sample_rate
            
            # Create an in-memory WAV file
            wav_buffer = io.BytesIO()
            
            with wave.open(wav_buffer, 'wb') as wav_file:
                wav_file.setnchannels(channels)
                wav_file.setsampwidth(sample_width)
                wav_file.setframerate(sample_rate)
                wav_file.writeframes(pcm_data)
            
            # Get the WAV data
            wav_data = wav_buffer.getvalue()
            wav_buffer.close()
            
            logger.debug(f"Converted {len(pcm_data)} bytes PCM to {len(wav_data)} bytes WAV")
            return wav_data
            
        except Exception as e:
            logger.error(f"PCM to WAV conversion failed: {str(e)}")
            raise
    
    def process_audio_chunk(
        self, 
        audio_data: bytes,
        sample_rate: Optional[int] = None
    ) -> Tuple[bytes, bool]:
        """
        Process an audio chunk with enhanced VAD and noise suppression.
        
        Args:
            audio_data: Raw audio data
            sample_rate: Audio sample rate (defaults to configured rate)
            
        Returns:
            Tuple of (processed_audio, has_speech)
        """
        try:
            sample_rate = sample_rate or self.sample_rate
            
            # Check if VAD is available
            if not self.vad:
                return audio_data, False  # Conservative approach if VAD not available
            
            # Calculate frame size for VAD (WebRTC VAD requires 10ms, 20ms, or 30ms frames)
            # Use 20ms frames for better balance between accuracy and latency
            vad_frame_duration_ms = 20
            frame_size = int(sample_rate * vad_frame_duration_ms / 1000)
            
            # Convert bytes to 16-bit PCM samples
            # Ensure buffer size is aligned for int16 (2 bytes per sample)
            if len(audio_data) % 2 != 0:
                # Pad with a zero byte if odd length
                audio_data = audio_data + b'\x00'
            
            audio_samples = np.frombuffer(audio_data, dtype=np.int16)
            
            # Basic audio validation - check if audio has sufficient energy
            if len(audio_samples) == 0:
                return audio_data, False
            
            # Calculate RMS for dynamic thresholding
            rms = np.sqrt(np.mean(audio_samples.astype(np.float32) ** 2))
            
            # Update noise floor estimation
            self._update_noise_floor(rms)
            
            # Dynamic noise threshold based on adaptive noise floor
            dynamic_threshold = self.noise_floor * self.adaptive_threshold_multiplier
            
            if rms < dynamic_threshold:
                logger.debug(f"Audio below adaptive threshold: RMS={rms:.1f}, threshold={dynamic_threshold:.1f}")
                return audio_data, False
            
            # Process audio in frames
            speech_frame_count = 0
            total_frame_count = 0
            processed_frames = []
            
            for i in range(0, len(audio_samples), frame_size):
                frame = audio_samples[i:i + frame_size]
                
                # Pad frame if necessary
                if len(frame) < frame_size:
                    frame = np.pad(frame, (0, frame_size - len(frame)), 'constant')
                
                # Convert to bytes for VAD
                frame_bytes = frame.tobytes()
                
                # Check for speech activity
                try:
                    # Ensure frame is exactly the right size for VAD
                    if len(frame_bytes) == frame_size * 2:  # 2 bytes per int16 sample
                        if self.vad.is_speech(frame_bytes, sample_rate):
                            speech_frame_count += 1
                            self.speech_frames.append(True)
                            processed_frames.append(frame)
                        else:
                            self.silence_frames.append(True)
                    else:
                        logger.debug(f"Frame size mismatch: expected {frame_size * 2} bytes, got {len(frame_bytes)}")
                        processed_frames.append(frame)  # Include frame anyway
                        
                    total_frame_count += 1
                except Exception as e:
                    logger.warning(f"VAD processing error: {str(e)}")
                    processed_frames.append(frame)  # Include frame anyway
                    total_frame_count += 1
            
            # Calculate speech confidence ratio
            if total_frame_count == 0:
                return audio_data, False
            
            speech_ratio = speech_frame_count / total_frame_count
            
            # Apply minimum speech duration and confidence threshold
            has_significant_speech = (
                speech_ratio >= self.speech_threshold and 
                speech_frame_count >= 2  # At least 2 frames must be speech
            )
            
            # Maintain rolling window of speech/silence detection
            self._cleanup_frame_history()
            
            if has_significant_speech and processed_frames:
                # Combine processed frames
                processed_audio = np.concatenate(processed_frames)
                logger.debug(f"Speech detected: {speech_frame_count}/{total_frame_count} frames, ratio: {speech_ratio:.3f}")
                return processed_audio.tobytes(), True
            else:
                logger.debug(f"No significant speech: {speech_frame_count}/{total_frame_count} frames, ratio: {speech_ratio:.3f}")
                return audio_data, False
                
        except Exception as e:
            logger.error(f"Audio processing failed: {str(e)}")
            return audio_data, False  # Conservative approach on error
    
    def _cleanup_frame_history(self):
        """Clean up frame history to prevent memory buildup."""
        # Keep only last 100 frames of history
        max_frames = 100
        if len(self.speech_frames) > max_frames:
            self.speech_frames = self.speech_frames[-max_frames:]
        if len(self.silence_frames) > max_frames:
            self.silence_frames = self.silence_frames[-max_frames:]
    
    def _update_noise_floor(self, rms: float):
        """Update adaptive noise floor based on recent audio samples."""
        try:
            # Add sample to noise estimation (only if likely to be noise)
            if len(self.speech_frames) == 0 or len(self.silence_frames) > len(self.speech_frames):
                self.noise_samples.append(rms)
                
                # Limit noise sample history
                if len(self.noise_samples) > self.max_noise_samples:
                    self.noise_samples = self.noise_samples[-self.max_noise_samples:]
                
                # Update noise floor as running average of lower percentile
                if len(self.noise_samples) >= 10:
                    sorted_samples = sorted(self.noise_samples)
                    # Use 25th percentile as noise floor estimate
                    percentile_index = len(sorted_samples) // 4
                    new_noise_floor = sorted_samples[percentile_index]
                    
                    # Smooth the update
                    self.noise_floor = 0.9 * self.noise_floor + 0.1 * new_noise_floor
                    
                    logger.debug(f"Updated noise floor: {self.noise_floor:.1f} (from {len(self.noise_samples)} samples)")
                    
        except Exception as e:
            logger.warning(f"Noise floor update failed: {str(e)}")
    
    def get_noise_floor_info(self) -> dict:
        """Get current noise floor information for debugging."""
        return {
            "noise_floor": self.noise_floor,
            "samples_count": len(self.noise_samples),
            "current_threshold": self.noise_floor * self.adaptive_threshold_multiplier,
            "vad_mode": self.vad_mode
        }
    
    def apply_noise_suppression(self, audio_data: bytes) -> bytes:
        """
        Apply basic noise suppression to audio data.
        
        Args:
            audio_data: Raw audio data
            
        Returns:
            Noise-suppressed audio data
        """
        try:
            # Convert to numpy array
            # Ensure buffer size is aligned for int16 (2 bytes per sample)
            if len(audio_data) % 2 != 0:
                audio_data = audio_data + b'\x00'
            
            audio_samples = np.frombuffer(audio_data, dtype=np.int16)
            
            # Simple noise gate (remove very quiet parts)
            threshold = np.std(audio_samples) * 0.1
            audio_samples[np.abs(audio_samples) < threshold] = 0
            
            # Simple high-pass filter to remove low-frequency noise
            # This is a basic implementation - for production, use a proper filter
            if len(audio_samples) > 1:
                # Simple first-order high-pass filter
                alpha = 0.95
                filtered = np.zeros_like(audio_samples, dtype=np.float32)
                filtered[0] = audio_samples[0]
                
                for i in range(1, len(audio_samples)):
                    filtered[i] = alpha * (filtered[i-1] + audio_samples[i] - audio_samples[i-1])
                
                # Convert back to int16
                audio_samples = np.clip(filtered, -32768, 32767).astype(np.int16)
            
            return audio_samples.tobytes()
            
        except Exception as e:
            logger.error(f"Noise suppression failed: {str(e)}")
            return audio_data
    
    def normalize_audio(self, audio_data: bytes) -> bytes:
        """
        Normalize audio levels.
        
        Args:
            audio_data: Raw audio data
            
        Returns:
            Normalized audio data
        """
        try:
            # Ensure buffer size is aligned for int16 (2 bytes per sample)
            if len(audio_data) % 2 != 0:
                audio_data = audio_data + b'\x00'
            
            audio_samples = np.frombuffer(audio_data, dtype=np.int16)
            
            # Calculate RMS
            rms = np.sqrt(np.mean(audio_samples.astype(np.float32) ** 2))
            
            if rms > 0:
                # Normalize to target RMS
                target_rms = 5000  # Adjustable target
                gain = target_rms / rms
                
                # Apply gain with clipping
                normalized = np.clip(audio_samples * gain, -32768, 32767)
                return normalized.astype(np.int16).tobytes()
            
            return audio_data
            
        except Exception as e:
            logger.error(f"Audio normalization failed: {str(e)}")
            return audio_data
    
    def detect_silence(self, audio_data: bytes, threshold_ms: int = 500) -> bool:
        """
        Detect if audio contains only silence.
        
        Args:
            audio_data: Raw audio data
            threshold_ms: Minimum silence duration in milliseconds
            
        Returns:
            True if audio is silent
        """
        try:
            if not self.vad:
                return False
            
            # Ensure buffer size is aligned for int16 (2 bytes per sample)
            if len(audio_data) % 2 != 0:
                audio_data = audio_data + b'\x00'
            
            audio_samples = np.frombuffer(audio_data, dtype=np.int16)
            frame_size = int(self.sample_rate * self.chunk_duration_ms / 1000)
            
            silence_frames = 0
            total_frames = 0
            
            for i in range(0, len(audio_samples), frame_size):
                frame = audio_samples[i:i + frame_size]
                
                if len(frame) < frame_size:
                    frame = np.pad(frame, (0, frame_size - len(frame)), 'constant')
                
                frame_bytes = frame.tobytes()
                
                try:
                    if not self.vad.is_speech(frame_bytes, self.sample_rate):
                        silence_frames += 1
                    total_frames += 1
                except Exception:
                    total_frames += 1
            
            if total_frames == 0:
                return True
            
            silence_ratio = silence_frames / total_frames
            silence_duration_ms = (silence_ratio * len(audio_samples) / self.sample_rate) * 1000
            
            return silence_duration_ms >= threshold_ms
            
        except Exception as e:
            logger.error(f"Silence detection failed: {str(e)}")
            return False
    
    def get_audio_duration(self, audio_data: bytes) -> float:
        """
        Calculate audio duration in milliseconds.
        
        Args:
            audio_data: Raw audio data
            
        Returns:
            Duration in milliseconds
        """
        try:
            # Ensure buffer size is aligned for int16 (2 bytes per sample)
            if len(audio_data) % 2 != 0:
                audio_data = audio_data + b'\x00'
            
            audio_samples = np.frombuffer(audio_data, dtype=np.int16)
            duration_seconds = len(audio_samples) / self.sample_rate
            return duration_seconds * 1000
        except Exception as e:
            logger.error(f"Duration calculation failed: {str(e)}")
            return 0.0
    
    def is_vad_available(self) -> bool:
        """Check if VAD is available."""
        return self.vad is not None


# Global audio service instance
audio_service = AudioService() 