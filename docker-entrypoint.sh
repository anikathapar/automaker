#!/bin/sh
set -e

. /usr/local/bin/docker-entrypoint-setup.sh
automaker_container_setup

# Switch to automaker user and execute the command
exec gosu automaker "$@"
