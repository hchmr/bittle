BITTLEC ?= bittlec
SRC_DIR ?= $(abspath ./src)
BUILD_DIR ?= $(abspath ./out/build)

BITTLE_HEADERS = $(shell find $(SRC_DIR) -name '*.btls')
BITTLE_FILES = $(shell find $(SRC_DIR) -name '*.btl')
ASM_FILES = $(patsubst $(SRC_DIR)/%.btl, $(BUILD_DIR)/%.s, $(BITTLE_FILES))
OBJ_FILES = $(patsubst $(BUILD_DIR)/%.s, $(BUILD_DIR)/%.o, $(ASM_FILES))
EXE_FILE = $(BUILD_DIR)/bittlec

.PHONY: build
build: $(EXE_FILE)

$(EXE_FILE): $(OBJ_FILES)
	gcc -g $^ -o $@

$(BUILD_DIR)/%.o: $(BUILD_DIR)/%.s
	gcc -g -c $< -o $@

.PRECIOUS: $(BUILD_DIR)/%.s
$(BUILD_DIR)/%.s: $(SRC_DIR)/%.btl $(BITTLE_HEADERS)
	mkdir -p $(dir $@)
	$(BITTLEC) $< > $@

.PHONY: clean
clean:
	rm -f $(EXE_FILE) $(OBJ_FILES) $(ASM_FILES)
