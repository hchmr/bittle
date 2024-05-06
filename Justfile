stage1-compile:
    ./scripts/compile -o out/cog1 self-host/main.cog

stage1-dbg:
    just stage1-compile
    lldb --source scripts/stage1.lldb

stage1:
    just stage1-compile
    ./out/cog1 < self-host/main.cog
