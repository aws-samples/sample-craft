FROM public.ecr.aws/lambda/python:3.9

# Install essential tools first
RUN yum update -y && \
    yum install -y \
    wget \
    tar \
    gzip \
    xz \
    which \
    cpio \
    rpm-build \
    yum-utils

# Install system dependencies
RUN yum install -y --skip-broken \
    # Java Runtime Environment
    java-11-openjdk \
    java-11-openjdk-headless \
    # Chinese fonts
    wqy-microhei-fonts \
    wqy-zenhei-fonts \
    wqy-unibit-fonts \
    # X11 and graphics
    libXext \
    libXrender \
    libSM \
    libXt \
    libX11 \
    libXau \
    libXcomposite \
    libXcursor \
    libXdamage \
    libXfixes \
    libXi \
    libXinerama \
    libXrandr \
    libXss \
    libXtst \
    libXxf86vm \
    libxcb \
    libxcb-render \
    libxcb-shm \
    libxcb-xfixes \
    libxcb-icccm4 \
    libxcb-image0 \
    libxcb-keysyms1 \
    libxcb-randr0 \
    libxcb-render-util0 \
    libxcb-shape0 \
    libxcb-sync1 \
    libxcb-xinerama0 \
    libxcb-xkb \
    libxcb-xrm \
    libxcb-xtest0 \
    libxkbcommon \
    libxkbcommon-x11 \
    libxshmfence \
    # Graphics and rendering
    mesa-libGL \
    mesa-libEGL \
    libglvnd-egl \
    libdrm \
    libgbm \
    cairo \
    pixman \
    pango \
    # Fonts and text
    fontconfig \
    freetype \
    liberation-fonts \
    dejavu-sans-fonts \
    dejavu-serif-fonts \
    dejavu-sans-mono-fonts \
    # Printing
    cups \
    cups-libs \
    cups-client \
    cups-devel \
    cups-pdf \
    # Image formats
    libpng \
    libjpeg-turbo \
    libtiff \
    libwebp \
    # XML and document processing
    libxml2 \
    libxslt \
    libexslt \
    # Security and certificates
    nss \
    nspr \
    openssl-libs \
    # System libraries
    dbus-libs \
    libICE \
    libuuid \
    libcap \
    pam \
    lz4 \
    elfutils-libs \
    systemd-libs \
    # Wayland support
    libwayland-client \
    libwayland-cursor \
    libwayland-egl \
    libwayland-server \
    # Additional utilities
    zip \
    jq \
    expat \
    # Additional dependencies
    gtk3 \
    atk \
    at-spi2-atk \
    at-spi2-core \
    gdk-pixbuf2 \
    gtk-update-icon-cache \
    hicolor-icon-theme \
    adwaita-icon-theme \
    --setopt=install_weak_deps=False \
    --setopt=tsflags=nodocs

# Copy and install LibreOffice from local file
COPY LibreOffice_7.6.7.2_Linux_x86-64_rpm.tar.gz /tmp/
RUN cd /tmp && \
    tar -xzf LibreOffice_7.6.7.2_Linux_x86-64_rpm.tar.gz && \
    cd LibreOffice_7.6*/RPMS && \
    for rpm in *.rpm; do rpm2cpio "$rpm" | cpio -idmv; done && \
    rm -rf /opt/libreoffice && \
    mv opt/libreoffice7.6 /opt/libreoffice && \
    cd / && rm -rf /tmp/*

# Create necessary directories and symbolic links for CUPS libraries
RUN mkdir -p /opt/libreoffice/lib64 && \
    ln -sf /usr/lib64/libcups.so.2 /opt/libreoffice/program/libcups.so.2 && \
    ln -sf /usr/lib64/libcups.so.2 /opt/libreoffice/lib64/libcups.so.2

# Set environment variables
ENV PATH="/opt/libreoffice/program:${PATH}"
ENV LD_LIBRARY_PATH="/opt/libreoffice/program:/opt/libreoffice/lib64:/usr/lib64:${LD_LIBRARY_PATH}"
ENV FONTCONFIG_PATH="/opt/libreoffice/etc/fonts"
ENV HOME="/tmp"
ENV XDG_RUNTIME_DIR="/tmp/runtime"
ENV QT_QPA_PLATFORM="offscreen"

# Set Java environment variables
ENV JAVA_HOME="/usr/lib/jvm/java-11-openjdk"
ENV PATH="${JAVA_HOME}/bin:${PATH}"

# Configure fontconfig
RUN mkdir -p /etc/fonts/conf.d && \
    echo '<?xml version="1.0"?>' > /etc/fonts/conf.d/99-custom.conf && \
    echo '<!DOCTYPE fontconfig SYSTEM "fonts.dtd">' >> /etc/fonts/conf.d/99-custom.conf && \
    echo '<fontconfig>' >> /etc/fonts/conf.d/99-custom.conf && \
    echo '  <match target="pattern">' >> /etc/fonts/conf.d/99-custom.conf && \
    echo '    <test qual="any" name="family"><string>sans-serif</string></test>' >> /etc/fonts/conf.d/99-custom.conf && \
    echo '    <edit name="family" mode="prepend" binding="same"><string>WenQuanYi Micro Hei</string></edit>' >> /etc/fonts/conf.d/99-custom.conf && \
    echo '  </match>' >> /etc/fonts/conf.d/99-custom.conf && \
    echo '</fontconfig>' >> /etc/fonts/conf.d/99-custom.conf

# Create necessary directories
RUN mkdir -p /tmp/runtime && \
    chmod 700 /tmp/runtime

# Copy function code
COPY doc_converter_process.py ${LAMBDA_TASK_ROOT}

# Install Python dependencies
# COPY requirements.txt .
# RUN pip install -r requirements.txt

# Set the CMD to your handler
CMD [ "doc_converter_process.lambda_handler" ]
