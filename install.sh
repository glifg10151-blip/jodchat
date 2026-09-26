#!/bin/bash
set -e

REPO="sythoria/sythoria-desktop"

echo "Fetching release information from GitHub..."
RELEASE_JSON=$(curl -s "https://api.github.com/repos/$REPO/releases/latest")

LATEST_TAG=$(echo "$RELEASE_JSON" | grep '"tag_name":' | head -n 1 | sed -E 's/.*"([^"]+)".*/\1/' | tr -d '\r')

if [ -z "$LATEST_TAG" ]; then
    echo "Error: Could not fetch latest release version from GitHub."
    exit 1
fi

echo "Detected latest Sythoria version tag: $LATEST_TAG"

# Detect if root or if sudo is available
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
    if command -v sudo >/dev/null 2>&1; then
        SUDO="sudo"
    else
        echo "Error: This script requires root privileges or sudo to install system packages."
        exit 1
    fi
fi

# Detect the operating system
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
    OS_LIKE=$ID_LIKE
else
    echo "Cannot detect Linux distribution. Unsupported system."
    exit 1
fi

TMP_DIR=$(mktemp -d)
cd "$TMP_DIR"

install_deb() {
    echo "Downloading Debian/Ubuntu (.deb) package..."
    URL=$(echo "$RELEASE_JSON" | grep -o "https://github.com/$REPO/releases/download/[^\"]*amd64\.deb" | head -n 1 | tr -d '\r')
    if [ -z "$URL" ]; then
        echo "Could not find .deb asset in latest release. Falling back to AppImage..."
        install_appimage
        return
    fi
    curl -fsSL -o "sythoria.deb" "$URL"
    echo "Installing..."
    $SUDO apt-get update
    $SUDO apt-get install -y ./sythoria.deb
}

install_rpm() {
    echo "Downloading Fedora/RHEL (.rpm) package..."
    URL=$(echo "$RELEASE_JSON" | grep -o "https://github.com/$REPO/releases/download/[^\"]*x86_64\.rpm" | head -n 1 | tr -d '\r')
    if [ -z "$URL" ]; then
        echo "Could not find .rpm asset in latest release. Falling back to AppImage..."
        install_appimage
        return
    fi
    curl -fsSL -o "sythoria.rpm" "$URL"
    echo "Installing..."
    $SUDO dnf install -y ./sythoria.rpm
}

install_appimage() {
    echo "Downloading universal AppImage..."
    URL=$(echo "$RELEASE_JSON" | grep -o "https://github.com/$REPO/releases/download/[^\"]*amd64\.AppImage" | head -n 1 | tr -d '\r')
    if [ -z "$URL" ]; then
        echo "Error: Could not find AppImage release asset."
        exit 1
    fi
    curl -fsSL -o "sythoria.AppImage" "$URL"
    
    echo "Installing AppImage..."
    mkdir -p ~/.local/bin
    mv ./sythoria.AppImage ~/.local/bin/sythoria
    chmod +x ~/.local/bin/sythoria

    echo "Downloading application icon..."
    mkdir -p ~/.local/share/icons
    ICON_PATH="$HOME/.local/share/icons/sythoria.png"
    curl -fsSL -o "$ICON_PATH" "https://raw.githubusercontent.com/$REPO/main/src-tauri/icons/icon.png" || true

    echo "Creating desktop menu entry..."
    mkdir -p ~/.local/share/applications
    cat <<EOF > ~/.local/share/applications/sythoria.desktop
[Desktop Entry]
Name=Sythoria
Exec=$HOME/.local/bin/sythoria
Icon=$ICON_PATH
Type=Application
Categories=Utility;Chat;
Terminal=false
EOF

    if command -v update-desktop-database >/dev/null 2>&1; then
        update-desktop-database ~/.local/share/applications || true
    fi

    echo "Sythoria installed! You can launch it from your application menu."
}

# Route to the correct installer based on OS
case $OS in
    ubuntu|debian|linuxmint|pop)
        install_deb
        ;;
    fedora|centos|rhel)
        install_rpm
        ;;
    *)
        case $OS_LIKE in
            *debian*|*ubuntu*) install_deb ;;
            *fedora*|*rhel*) install_rpm ;;
            *)
                echo "Distribution '$OS' does not use apt or dnf."
                echo "Falling back to universal AppImage installation..."
                install_appimage
                ;;
        esac
        ;;
esac

# Cleanup temp files
cd ~
rm -rf "$TMP_DIR"
echo "Installation complete!"
