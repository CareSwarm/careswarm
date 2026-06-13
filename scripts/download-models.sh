#!/usr/bin/env bash
# Downloads the MedPsy GGUF models from Hugging Face into QVAC_MODELS_DIR.
# Setup-time only — after this the entire demo runs offline (see APIS.json).
# Resumable: re-running continues partial downloads (curl -C -).
set -euo pipefail

MODELS_DIR="${QVAC_MODELS_DIR:-./models}"
mkdir -p "$MODELS_DIR"

download() {
  local url="$1" out="$2"
  if [ -f "$MODELS_DIR/$out.done" ]; then
    echo "✓ $out already downloaded"
    return
  fi
  echo "↓ $out"
  curl -L -C - --fail --progress-bar -o "$MODELS_DIR/$out" "$url"
  touch "$MODELS_DIR/$out.done"
  echo "✓ $out"
}

download "https://huggingface.co/qvac/MedPsy-1.7B-GGUF/resolve/main/medpsy-1.7b-q4_k_m-imat.gguf" "medpsy-1.7b-q4_k_m-imat.gguf"
download "https://huggingface.co/qvac/MedPsy-4B-GGUF/resolve/main/medpsy-4b-q4_k_m-imat.gguf" "medpsy-4b-q4_k_m-imat.gguf"

echo
echo "All models in $MODELS_DIR:"
ls -lh "$MODELS_DIR" | grep -v '.done'
