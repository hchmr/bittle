stage0-compile:
    cmake --build ./bootstrap/cmake-build-debug

stage0-dbg:
    just stage0-compile
    lldb --source scripts/stage0.lldb

stage0:
    just stage0-compile
    lldb --source scripts/stage0.lldb -o quit

stage1-compile:
    ./scripts/compile -o out/cog1 self-host/main.cog

stage1-dbg:
    just stage1-compile
    lldb --source scripts/stage1.lldb

stage1:
    just stage1-compile
    lldb --source scripts/stage1.lldb -o quit
