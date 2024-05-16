build:
    mkdir -p out
    make -C compiler "BUILD_DIR=../out"

bootstrap:
    ./scripts/bootstrap
