FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV USE_SYSTEM_CHROME=true
ENV HEADLESS=true
ENV CHROME_PROFILE_DIR=/app/data/chrome-profile
ENV OUTPUT_DIR=/app/output
ENV LOCALE=en
ENV GENERATION_TIMEOUT_MS=180000
ENV POLL_INTERVAL_MS=2000
ENV ACTION_TIMEOUT_MS=30000

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates fonts-liberation fonts-noto-cjk libasound2 libatk-bridge2.0-0 libatk1.0-0 \
    libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgbm1 \
    libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 libpangocairo-1.0-0 \
    libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 \
    libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 \
    xdg-utils xvfb \
    wget gnupg \
  && wget -q -O /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
  && apt-get install -y --no-install-recommends /tmp/chrome.deb \
  && rm -rf /var/lib/apt/lists/* /tmp/chrome.deb

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY bin ./bin
COPY src ./src
COPY .env.example ./.env.example
RUN chmod +x bin/xvfb-wrapper.sh

RUN mkdir -p /app/data/chrome-profile /app/output
VOLUME ["/app/data", "/app/output"]

# Linux Chrome UA (matches real Chrome on Linux, reduces 403 risk vs Windows UA)
ENV FLOW_USER_AGENT="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36"

# New headless mode is more stealth than old --headless
ENV CHROMIUM_LAUNCHER_HEADLESS_MODE=new

# Set USE_XVFB=true to enable virtual display fallback (when headless=new still gets 403)
ENV USE_XVFB=false

ENTRYPOINT ["bin/xvfb-wrapper.sh"]
CMD ["serve"]
