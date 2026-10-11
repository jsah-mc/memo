FROM trycua/cua-xfce:latest

LABEL org.opencontainers.image.title="Memo CUA Desktop" \
      org.opencontainers.image.description="Portable isolated Linux desktop for Memo computer use" \
      org.opencontainers.image.source="https://github.com/jsah-mc/memo"

USER root

# Give CUA Driver a useful, predictable desktop instead of an empty XFCE shell.
# Keep this list distribution-native so accessibility and background X11 input
# continue to use the libraries supplied by the canonical CUA base image.
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        at-spi2-core \
        ca-certificates \
        curl \
        dbus-x11 \
        evince \
        file \
        fonts-dejavu \
        fonts-liberation \
        fonts-noto-color-emoji \
        fonts-noto-core \
        galculator \
        git \
        jq \
        libreoffice-calc \
        libreoffice-impress \
        libreoffice-writer \
        mousepad \
        p7zip-full \
        python3 \
        python3-pip \
        ristretto \
        thunar \
        unzip \
        wget \
        xarchiver \
        xclip \
        xdg-utils \
        xsel \
        xfce4-terminal \
    && browser_package="$(for package in chromium chromium-browser firefox-esr firefox; do apt-cache show "$package" >/dev/null 2>&1 && { echo "$package"; break; }; done)" \
    && test -n "$browser_package" \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$browser_package" \
    && ln -sf "$(command -v "$browser_package")" /usr/local/bin/memo-browser \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

ENV BROWSER=/usr/local/bin/memo-browser \
    GTK_MODULES=gail:atk-bridge \
    NO_AT_BRIDGE=0

WORKDIR /workspace
