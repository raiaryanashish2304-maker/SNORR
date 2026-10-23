# SNOR — AI Study Tutor

SNOR turns a syllabus or study file into three pre-lesson questions, personalized feedback, and a concise learning guide.

## Requirements

- Node.js 20 or newer
- Python 3.10 or newer to use the optional Python launcher
- A Google AI API key for live analysis and quiz grading
- An ElevenLabs API key is optional; without it, voiceover uses the browser's built-in speech synthesis

No Node or Python packages need to be installed.

## Quick start

1. Open this project folder in VS Code.
2. Copy `.env.example` to `.env` and add your API keys (see below).
3. In a terminal at the project folder, start SNOR using either:

   ```sh
   npm start
   ```

   or:

   ```sh
   python start.py
   ```

4. Visit [http://localhost:4173](http://localhost:4173).

The Python launcher starts the Node server from the project folder, checks that Node.js 20+ is available, waits for the health endpoint, and stops the server when you press Ctrl+C. Use `python start.py --open-browser` to open the page automatically. You can override the bind address or port with `--host` and `--port`; `HOST` and `PORT` in `.env` are also supported. The default bind address is `127.0.0.1`.

## Configure API keys

Copy `.env.example` to `.env` and set the values you need:

| Variable | Purpose |
| --- | --- |
| `GOOGLE_API_KEY` | Enables live Gemma analysis and quiz grading. |
| `GEMMA_MODEL` | Optional model override; defaults to the model in `.env.example`. |
| `ELEVENLABS_API_KEY` | Optional generated voiceover service. |
| `ELEVENLABS_VOICE_ID` | Optional ElevenLabs voice selection. |
| `ELEVENLABS_MODEL` | Optional ElevenLabs model selection. |
| `PORT` | Optional server port; defaults to `4173`. |
| `HOST` | Optional bind address; defaults to `127.0.0.1`. |

After changing `.env`, restart the server. Keep `.env` private: it is excluded from Git, while `.env.example` is safe to include in a public repository. Never put real API keys in source files, screenshots, or commits. Rotate any key that has been exposed.

## Study flow and supported files

Choose one of the starter prompts or enter your own request, then upload a PDF, DOCX, TXT, PNG, JPG, or WebP file (up to 14 MB). SNOR creates three topic-specific pre-lesson questions—easy, medium, and hard. Submit your answers, including blank or incorrect answers, to receive a rating, feedback, and suggested improvement areas. The lesson and key points are then revealed. Quiz answer keys remain on the server and are not sent to the browser.

TXT and DOCX text is extracted in the browser. PDFs and images are sent to Google AI for analysis. Images embedded in DOCX files are not analyzed. The app does not connect to Google Classroom.

## Voiceover

After submitting the pre-lesson questions, choose **Generate voiceover** to hear the rating, feedback, improvement areas, lesson summary, and key points.

- With `ELEVENLABS_API_KEY` configured, SNOR requests and plays generated MP3 audio from ElevenLabs. This uses your ElevenLabs account and may consume credits; generation only happens after you press the button.
- Without an ElevenLabs key, SNOR offers the browser's built-in speech synthesis instead. This fallback does not make a voice-generation API request.

## GitHub

The project is ready to publish as source: `.env`, dependencies, Python caches, editor metadata, and logs are ignored. Before publishing, check that your API keys are stored only in your local `.env` and that `.env.example` contains placeholders, not real credentials. This folder may not have Git initialized; create a repository and add a remote if you want to push it to GitHub.
