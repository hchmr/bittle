FROM --platform=arm64 ubuntu:24.04

RUN apt-get update

RUN apt-get install -y \
    build-essential \
    sudo \
    curl \
    just \
    git

RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash -

RUN apt-get install -y nodejs

RUN rm -rf /var/lib/apt/lists/*

RUN useradd -m -s /bin/bash anon

RUN echo 'anon ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/anon

RUN <<EOF cat >> /etc/ssh/sshd_config
Match User anon
    PasswordAuthentication no
Match All
EOF
