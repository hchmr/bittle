BITTLEC ?= bittlec
SRC_DIR ?= ./src
BUILD_DIR ?= ./out/build

BITTLE_HEADERS = $(wildcard $(SRC_DIR)/*.btls)
BITTLE_FILES = $(wildcard $(SRC_DIR)/*.btl)
ASM_FILES = $(patsubst $(SRC_DIR)/%.btl, $(BUILD_DIR)/%.s, $(BITTLE_FILES))
OBJ_FILES = $(patsubst $(BUILD_DIR)/%.s, $(BUILD_DIR)/%.o, $(ASM_FILES))
EXE_FILE = $(BUILD_DIR)/bittlec

build: $(EXE_FILE)

$(EXE_FILE): $(OBJ_FILES)
	gcc -g $^ -o $@

$(BUILD_DIR)/%.o: $(BUILD_DIR)/%.s
	gcc -g -c $< -o $@

.PRECIOUS: $(BUILD_DIR)/%.s
$(BUILD_DIR)/%.s: $(SRC_DIR)/%.btl $(BITTLE_HEADERS) $(BUILD_DIR)
	mkdir -p $(BUILD_DIR)
	$(BITTLEC) $< > $@

.PHONY: clean
clean:
	rm -f $(EXE_FILE) $(OBJ_FILES) $(ASM_FILES)
