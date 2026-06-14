# Deploying the P2P provider on a remote box

The clinician step (MedPsy-4B) is the heavy one. On an 8GB laptop you can
delegate it to a provider running on a roomier machine — a $5 VPS, a desktop,
or a second laptop. The provider hosts the model over the Hyperswarm DHT; the
laptop connects by public key and pays per session. `fallbackToLocal` means
the laptop still works if the provider is gone.

Tested on Ubuntu 24.04, ARM64, 15GB RAM.

```bash
# on the provider box
mkdir -p ~/cs-provider/models && cd ~/cs-provider
# Node 22+ (QVAC needs >= 22.17)
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs
# runtime libs the QVAC native addons link against
apt-get install -y libatomic1 libvulkan1
# the model
curl -L -o models/medpsy-4b-q4_k_m-imat.gguf \
  https://huggingface.co/qvac/MedPsy-4B-GGUF/resolve/main/medpsy-4b-q4_k_m-imat.gguf
# the provider (copy vps-provider.mjs here as provider.mjs)
npm init -y && npm pkg set type=module && npm i @qvac/sdk
# the SDK spawns the `bare` runtime from PATH — expose it
ln -sf ../bare-runtime-linux-arm64/bin/bare node_modules/.bin/bare

# run as a service (copy cs-provider.service to /etc/systemd/system/)
systemctl daemon-reload && systemctl enable --now cs-provider
cat pubkey.txt        # → the provider's DHT public key
```

Then on the laptop:

```bash
node scripts/connect-provider.mjs <PROVIDER_PUBKEY>   # pays the session, points the clinician at it
```

Gotchas we hit (all handled by the service file above): the QVAC native addons
need `libatomic1` + `libvulkan1` even on a CPU-only box (the loader satisfies
the link, llama.cpp falls back to CPU), and the SDK launches its worker via
`bare` from `PATH`, so `node_modules/.bin/bare` must exist.
