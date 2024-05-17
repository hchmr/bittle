build:
    mkdir -p out
    make -C compiler "BUILD_DIR=../out"

debug:
    @just build
    lldb --source scripts/debug.lldb

run:
    @just build
    lldb --source scripts/debug.lldb -o run -o quit

bootstrap:
    ./scripts/bootstrap

bootstrap-next:
    rm -rf ./out/next
    mkdir -p ./out/next/stage1
    make -C compiler "BUILD_DIR=../out/next/stage1" "COGC=../out/bootstrap/bin/cogc"
    mkdir -p ./out/next/stage2
    make -C compiler "BUILD_DIR=../out/next/stage2" "COGC=../out/next/stage1/cogc"
    mkdir -p ./out/next/stage3
    make -C compiler "BUILD_DIR=../out/next/stage3" "COGC=../out/next/stage2/cogc"
    diff ./out/next/stage2/cogc.s ./out/next/stage3/cogc.s
    @echo "Success"
