export interface WhisperModelPreset {
  id: string;
  name: string;
  size: string;
  url: string;
  fileName: string;
  description: string;
}

export const WHISPER_PRESETS: WhisperModelPreset[] = [
  {
    id: "tiny.en",
    name: "Tiny (English only)",
    size: "75 MB",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin",
    fileName: "ggml-tiny.en.bin",
    description: "Fastest option, optimized for English speech transcription.",
  },
  {
    id: "tiny",
    name: "Tiny (Multilingual)",
    size: "75 MB",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
    fileName: "ggml-tiny.bin",
    description: "Ultra-lightweight, supports multiple languages.",
  },
  {
    id: "base.en",
    name: "Base (English only)",
    size: "142 MB",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
    fileName: "ggml-base.en.bin",
    description: "Good balance of speed and spelling accuracy for English.",
  },
  {
    id: "base",
    name: "Base (Multilingual)",
    size: "142 MB",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
    fileName: "ggml-base.bin",
    description: "Good general-purpose multilingual transcription model.",
  },
  {
    id: "small.en",
    name: "Small (English only)",
    size: "466 MB",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin",
    fileName: "ggml-small.en.bin",
    description: "High quality English model. Recommended for clear, detailed texts.",
  },
  {
    id: "small",
    name: "Small (Multilingual)",
    size: "466 MB",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
    fileName: "ggml-small.bin",
    description: "High quality multilingual model with low CPU impact.",
  },
  {
    id: "large-v3-turbo",
    name: "Large v3 Turbo",
    size: "1.5 GB",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin",
    fileName: "ggml-large-v3-turbo.bin",
    description: "Near large-v3 accuracy at a fraction of the compute costs.",
  },
];
