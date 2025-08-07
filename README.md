# Real-Time Conversational AI Assistant

A modern, **fully voice-activated** conversational AI assistant web application with continuous listening, real-time VAD processing, and auto-fading responses. Built using WebRTC, open-source LLMs, and advanced audio processing.

## Key Features

### **Live Voice Interface** (NEW!)
- **Continuous Listening**: Auto-starts on page load - no buttons required!
- **Voice Activity Detection**: Real-time VAD with `webrtcvad` processing
- **Live Audio Streaming**: WebSocket-based continuous audio pipeline
- **Smart Voice Processing**: Noise suppression, auto-gain, echo cancellation
- **Button-Free Experience**: Pure voice interaction - just speak naturally!

### **AI Response System**
- **Auto-Generated Responses**: Instant AI responses to voice input
- **Text-to-Speech**: Automatic speech synthesis and playback
- **20-Second Auto-Fade**: Responses fade away after TTS + 20 seconds
- **Continuous Loop**: Always ready for the next voice interaction

### **Modern Voice UI**
- **Live Audio Visualizer**: Real-time voice activity display
- **VAD Status Indicators**: Visual feedback for listening state
- **Smooth Animations**: Framer Motion powered transitions
- **Voice-First Design**: Minimal, distraction-free interface

### **Advanced Audio Processing**
- **Real-time VAD**: `webrtcvad` with configurable sensitivity
- **Audio Normalization**: Automatic level adjustment
- **Noise Suppression**: Advanced filtering algorithms
- **WebRTC Streaming**: Low-latency audio transmission

### **Real-time Communication**
- **WebSocket Streaming**: Continuous audio chunk processing
- **VAD-Triggered Transcription**: Process speech only when detected
- **Auto-Reconnection**: Robust connection management
- **Live Status Monitoring**: Real-time connection health

### **AI Models & Processing**
- **Open-Source LLMs**: Access to Llama, Mistral, CodeLlama via OpenRouter
- **Speech Recognition**: OpenAI Whisper integration
- **Text-to-Speech**: Coqui TTS with multiple voices
- **Streaming Responses**: Real-time text generation

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    LIVE VOICE INTERFACE                         │
├─────────────────────────────────────────────────────────────────┤
│  Audio Input → VAD → ASR → LLM → TTS → Audio Output  │
└─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────┐    WebSocket     ┌─────────────────┐
│   React Frontend │ ◄──────────────► │  FastAPI Backend │
│                 │  (Live Audio)    │                 │
│ • Live Audio    │                  │ • VAD Service   │
│ • Voice Visualizer│                │ • ASR Service   │
│ • Auto-Fade UI  │                  │ • LLM Service   │
│ • No Buttons!   │                  │ • TTS Service   │
└─────────────────┘                  │ • Streaming     │
                                     └─────────────────┘
                                              │
                                              ▼
                                     ┌─────────────────┐
                                     │  External APIs  │
                                     │                 │
                                     │ • OpenRouter    │
                                     │ • Whisper ASR   │
                                     │ • Coqui TTS     │
                                     │ • WebRTC VAD    │
                                     └─────────────────┘
```

## Quick Start

### Prerequisites

- **Docker & Docker Compose**
- **OpenRouter API Key** (for LLM and Whisper access)
- **Microphone permissions** (for voice input)

### 1. Clone the Repository

```bash
git clone <repository-url>
cd AI-Convo-Webapp
```

### 2. Environment Setup

Copy the example environment file and configure your settings:

```bash
cp env.example .env
```

Edit `.env` with your API keys:

```env
# Required: OpenRouter API Key
OPENROUTER_API_KEY=your_openrouter_api_key_here

# Security
SECRET_KEY=your_secret_key_here_make_it_long_and_random

# Voice Activity Detection
VAD_MODE=3                    # VAD sensitivity (0-3, higher = more sensitive)
SAMPLE_RATE=16000            # Audio sample rate for VAD
CHUNK_DURATION_MS=30         # VAD processing chunk size

# Audio Processing
ENABLE_NOISE_SUPPRESSION=true
ENABLE_AUTO_GAIN=true
ENABLE_ECHO_CANCELLATION=true

# TTS Configuration
TTS_MODEL=tts_models/en/ljspeech/tacotron2-DDC
TTS_DEFAULT_VOICE=ljspeech
RESPONSE_FADE_DELAY=20       # Seconds to fade response after TTS
```

### 3. Start with Docker Compose

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

### 4. Access the Voice Interface

- **Voice App**: http://localhost:3000
- **Backend API**: http://localhost:8000
- **API Documentation**: http://localhost:8000/docs

## How to Use the Voice Interface

### Getting Started
1. **Open the app** → http://localhost:3000
2. **Grant microphone permissions** when prompted
3. **Start speaking** → The app automatically starts listening!

### Voice Interaction Flow
```
Speak → VAD Detects → Transcribes → AI Responds → TTS Plays → Fades (20s)
```

### Visual Indicators
- **Green Pulse**: Listening and ready
- **Red Ripple**: Voice activity detected
- **Yellow**: Processing your speech
- **Blue**: AI generating response

### Tips for Best Experience
- **Speak clearly** and at normal volume
- **Wait for the pulse** to show it's listening
- **Pause briefly** between sentences
- **Stay within 3 feet** of microphone for best VAD detection

## Development Setup

### Backend Development

```bash
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run development server with VAD
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend Development

```bash
cd frontend

# Install dependencies
npm install

# Start development server (with live audio)
npm start

# Build for production
npm run build
```

## API Documentation

### Live Audio Endpoints

#### WebSocket Streaming
- `WS /api/v1/streaming/ws` - Live audio streaming endpoint
- **Message Types**:
  - `audio_chunk` - Raw audio data for VAD processing
  - `transcription_request` - Request speech transcription
  - `chat_request` - Send message to AI
  - `tts_request` - Generate speech audio

#### VAD & Audio Processing
- `POST /api/v1/audio/process` - Process audio with VAD
- `POST /api/v1/audio/normalize` - Normalize audio levels
- `GET /api/v1/audio/vad-status` - Check VAD configuration

### Traditional Endpoints

#### ASR (Speech-to-Text)
- `POST /api/v1/asr/transcribe` - Transcribe audio file
- `POST /api/v1/asr/transcribe-streaming` - Stream transcription

#### Chat (LLM)
- `POST /api/v1/chat/generate` - Generate AI response
- `POST /api/v1/chat/stream` - Streaming response

#### TTS (Text-to-Speech)
- `POST /api/v1/tts/synthesize` - Synthesize speech
- `GET /api/v1/tts/voices` - Available voices

## Configuration

### Voice Activity Detection Settings

| Variable | Description | Default |
|----------|-------------|---------|
| `VAD_MODE` | VAD sensitivity (0-3) | `3` |
| `SAMPLE_RATE` | Audio sample rate | `16000` |
| `CHUNK_DURATION_MS` | VAD processing chunk size | `30` |
| `SILENCE_THRESHOLD_MS` | Silence detection threshold | `500` |

### Audio Processing Settings

| Variable | Description | Default |
|----------|-------------|---------|
| `ENABLE_NOISE_SUPPRESSION` | Enable noise filtering | `true` |
| `ENABLE_AUTO_GAIN` | Enable auto-gain control | `true` |
| `ENABLE_ECHO_CANCELLATION` | Enable echo cancellation | `true` |
| `AUDIO_NORMALIZATION_TARGET` | Target audio level | `5000` |

### Response Behavior

| Variable | Description | Default |
|----------|-------------|---------|
| `RESPONSE_FADE_DELAY` | Seconds to fade after TTS | `20` |
| `TYPING_ANIMATION_SPEED` | Typing effect speed (ms) | `50` |
| `AUTO_PLAY_TTS` | Auto-play TTS responses | `true` |

## Customization

### Adjusting VAD Sensitivity

```python
# In backend/app/config.py
VAD_MODE = 3  # 0 = least sensitive, 3 = most sensitive
```

### Changing Response Fade Time

```typescript
// In frontend/src/components/ResponseDisplay.tsx
const FADE_DELAY = 20000; // 20 seconds (change as needed)
```

### Custom Audio Processing

```python
# In backend/app/services/audio_service.py
class AudioService:
    def process_audio_chunk(self, audio_data: bytes):
        # Add your custom VAD logic here
        pass
```

## Deployment

### Production Configuration

```bash
# Set production environment variables
export ENVIRONMENT=production
export VAD_MODE=3
export ENABLE_NOISE_SUPPRESSION=true
export RESPONSE_FADE_DELAY=20

# Deploy with Docker
docker-compose --profile production up -d
```

### Performance Optimization

- **VAD Processing**: Adjust `CHUNK_DURATION_MS` for latency vs accuracy
- **Audio Quality**: Set `SAMPLE_RATE` to 16000 for optimal VAD performance
- **Memory Usage**: Configure audio buffer sizes based on usage patterns

## Testing the Voice Interface

### Voice Testing Commands

```bash
# Test VAD sensitivity
curl -X POST http://localhost:8000/api/v1/audio/test-vad \
  -H "Content-Type: application/json" \
  -d '{"sensitivity": 3}'

# Test audio processing pipeline
curl -X POST http://localhost:8000/api/v1/audio/test-pipeline \
  -F "audio=@test_audio.wav"
```

### Browser Testing

1. **Open Developer Tools** → Console
2. **Check microphone permissions**
3. **Test WebSocket connection**
4. **Verify VAD detection**

## Contributing

### Voice Interface Development

1. **Frontend**: React components for live audio visualization
2. **Backend**: VAD and streaming audio processing
3. **WebSocket**: Real-time audio chunk handling
4. **Audio Processing**: VAD algorithms and noise suppression

### Testing Voice Features

- Test with different microphone setups
- Verify VAD sensitivity in various noise conditions
- Test auto-fade timing and TTS integration
- Validate WebSocket connection stability

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- **WebRTC VAD** for real-time voice activity detection
- **OpenRouter** for providing access to open-source LLMs
- **OpenAI** for Whisper speech recognition
- **Coqui AI** for open-source Text-to-Speech
- **Material-UI** for the beautiful component library
- **FastAPI** for the high-performance backend framework

## Support

For voice interface issues:
- **Audio Problems**: Check microphone permissions and VAD settings
- **Connection Issues**: Verify WebSocket connectivity
- **Performance**: Adjust VAD sensitivity and audio processing settings

- **Issues**: [GitHub Issues](https://github.com/your-repo/issues)
- **Discussions**: [GitHub Discussions](https://github.com/your-repo/discussions)
- **Documentation**: [Wiki](https://github.com/your-repo/wiki)

---

**Voice-First AI Assistant - Just Speak and Listen!**