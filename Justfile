build:
    mkdir -p out
    make -C compiler "BUILD_DIR=../out"

clean:
    make -C compiler clean "BUILD_DIR=../out"

debug:
    @just build
    lldb --source scripts/debug.lldb

run:
    @just build
    lldb --source scripts/debug.lldb -o run -o quit

bootstrap *args:
    ./scripts/bootstrap {{args}}
