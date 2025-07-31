FROM ubuntu:latest

# Install packages
RUN apt-get update
RUN apt-get install -y openssh-server

# configure ssh as expected in a PCS
RUN mkdir -p /root/.ssh \
    && chmod 700 /root/.ssh \
    && echo 'PermitRootLogin yes' >> /etc/ssh/sshd_config \
    && mkdir -p /run/sshd \
    && chmod 600 /root/.ssh/authorized_keys 2>/dev/null || true