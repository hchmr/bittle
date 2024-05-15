CC = gcc
CFLAGS = -std=c99
BUILD_DIR ?= .
TARGET ?= $(BUILD_DIR)/cogc
SRC = main.c

build: $(TARGET)

$(TARGET): $(SRC)
	$(CC) $(CFLAGS) -o $(TARGET) $(SRC)

.PHONY: clean
clean:
	rm -f $(TARGET)
