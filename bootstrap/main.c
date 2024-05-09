//=
//= Stage 0 compiler for the Cog Compiler
//=

#include <assert.h>
#include <stdarg.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

//= Misc

#define dbg(...) fprintf(stderr, __VA_ARGS__)

typedef struct Pos {
    int line;
    int col;
} Pos;

__dead2 void error_at(Pos *pos, const char *fmt, ...) {
    fprintf(stderr, "%d:%d: Error: ", pos->line, pos->col);
    va_list args;
    va_start(args, fmt);
    vfprintf(stderr, fmt, args);
    va_end(args);
    fprintf(stderr, "\n");
    exit(1);
}

bool str_eq(const char *a, const char *b) {
    return strcmp(a, b) == 0;
}

int align_up(int size, int align) {
    return (size + align - 1) / align * align;
}

int ilog2(int n) {
    int i = 0;
    while (n > 1) {
        n >>= 1;
        i += 1;
    }
    return i;
}

void sb_push(char **buf_p, char c) {
    size_t len = *buf_p ? strlen(*buf_p) : 0;
    *buf_p = realloc(*buf_p, len + 2);
    (*buf_p)[len] = c;
    (*buf_p)[len + 1] = '\0';
}

void sb_append(char **buf_p, const char *str) {
    while (*str) {
        sb_push(buf_p, *str);
        str = &str[1];
    }
}

void sb_append_int(char **buf_p, int n) {
    char s[22]; // sign + 20 digits + \0
    sprintf(s, "%d", n);
    sb_append(buf_p, s);
}

//= Type System

#define MAX_FIELDS 16

typedef enum TypeKind {
    Type_Void,
    Type_Bool,
    Type_Int,
    Type_Ptr,
    Type_Arr,
    Type_Struct,
} TypeKind;

typedef struct Type {
    TypeKind kind;
    // Int
    int size;
    // Pointer/array
    struct Type *base;
    // Array
    int len;
    // Struct
    const char *name;
    const char *field_names[MAX_FIELDS + 1];
    struct Type *field_types[MAX_FIELDS + 1];
    int field_offsets[MAX_FIELDS + 1];
    int field_count;
    int unpadded_size;
} Type;

Type *mk_type(TypeKind kind) {
    Type *type = calloc(1, sizeof(Type));
    type->kind = kind;
    return type;
}

Type *mk_int_type(int size) {
    Type *type = mk_type(Type_Int);
    type->size = size;
    return type;
}

Type *mk_bool_type(void) {
    return mk_type(Type_Bool);
}

Type *mk_ptr_type(Type *base) {
    Type *type = mk_type(Type_Ptr);
    type->base = base;
    return type;
}

Type *mk_arr_type(Type *base, int size) {
    Type *type = mk_type(Type_Arr);
    type->base = base;
    type->len = size;
    return type;
}

Type *mk_struct_type(const char *name) {
    Type *type = mk_type(Type_Struct);
    type->name = name;
    return type;
}

int type_align(Type *type) {
    if (type->kind == Type_Void)
        return -1;
    if (type->kind == Type_Bool)
        return 1;
    if (type->kind == Type_Int)
        return type->size;
    if (type->kind == Type_Ptr)
        return 8;
    if (type->kind == Type_Arr)
        return type_align(type->base);
    if (type->kind == Type_Struct)
        return 8; // Highest possible alignment
    assert(0);
}

int type_size(Type *type) {
    if (type->kind == Type_Void)
        return -1;
    if (type->kind == Type_Bool)
        return 1;
    if (type->kind == Type_Int)
        return type->size;
    if (type->kind == Type_Ptr)
        return 8;
    if (type->kind == Type_Arr)
        return align_up(type_size(type->base), type_align(type)) * type->len;
    if (type->kind == Type_Struct)
        return type->field_count == 0 ? -1 : align_up(type->unpadded_size, type_align(type));
    assert(0);
}

bool is_scalar(Type *type) {
    return type->kind == Type_Bool || type->kind == Type_Int || type->kind == Type_Ptr;
}

bool type_eq(Type *a, Type *b) {
    if (a->kind != b->kind)
        return false;
    if (a->kind == Type_Int)
        return a->size == b->size;
    if (a->kind == Type_Ptr)
        return type_eq(a->base, b->base);
    if (a->kind == Type_Arr)
        return a->len == b->len && type_eq(a->base, b->base);
    if (a->kind == Type_Struct)
        return a == b;
    return true;
}

// Subtyping for implicit conversions
bool type_le(Type *t1, Type *t2) {
    if (is_scalar(t1) && t2->kind == Type_Bool)
        return true;
    if (t1->kind == Type_Int && t2->kind == Type_Int)
        return t1->size <= t2->size;
    if (t1->kind == Type_Ptr && t2->kind == Type_Ptr)
        return t1->base->kind == Type_Void;
    return false;
}

void add_field(Type *type, const char *name, Type *field_type) {
    assert(type->kind == Type_Struct);
    if (type->field_count == MAX_FIELDS) {
        fprintf(stderr, "Too many fields\n");
        exit(1);
    }
    int n = type->field_count;
    type->field_names[n] = name;
    type->field_types[n] = field_type;
    type->field_offsets[n] = align_up(type->unpadded_size, type_align(field_type));
    type->unpadded_size = type->field_offsets[n] + type_size(field_type);
    type->field_count = n + 1;
}

int find_field(Type *type, char *name) {
    assert(type->kind == Type_Struct);

    int i = 0;
    while (i < type->field_count) {
        if (str_eq(type->field_names[i], name)) {
            return i;
        }
        i += 1;
    }
    return -1;
}

void pretty_type(char **buf_p, Type *type) {
    if (type->kind == Type_Void) {
        sb_append(buf_p, "Void");
    } else if (type->kind == Type_Bool) {
        sb_append(buf_p, "Bool");
    } else if (type->kind == Type_Int) {
        sb_append(buf_p, "Int");
        sb_append_int(buf_p, type->size * 8);
    } else if (type->kind == Type_Ptr) {
        sb_push(buf_p, '*');
        pretty_type(buf_p, type->base);
    } else if (type->kind == Type_Arr) {
        sb_push(buf_p, '[');
        pretty_type(buf_p, type->base);
        sb_append(buf_p, "; ");
        sb_append_int(buf_p, type->len);
        sb_push(buf_p, ']');
    } else if (type->kind == Type_Struct) {
        sb_append(buf_p, type->name);
    } else {
        assert(0);
    }
}

//= Codegen Constants

#define FRAME_LOCALS_SIZE 128
#define FRAME_TEMP_SIZE 512
#define FRAME_ARGS_SIZE 64
#define FRAME_SIZE (FRAME_LOCALS_SIZE + FRAME_TEMP_SIZE + FRAME_ARGS_SIZE)

//= Symbol Table

#define MAX_PARAMS 8
#define MAX_SCOPES 16

typedef enum SymKind {
    Sym_Local,
    Sym_Global,
    Sym_Const,
    Sym_Func,
    Sym_Type,
} SymKind;

typedef struct Symbol {
    SymKind kind;
    char *name;
    bool is_extern;
    // Variable type/return type/struct type
    Type *type;
    // Local variable
    int frame_offset;
    // Constant
    int value;
    // Function
    int param_count;
    char *param_names[MAX_PARAMS + 1];
    Type *param_types[MAX_PARAMS + 1];
    bool is_variadic;
    int locals_size;
    bool defined;
} Symbol;

Symbol **sym_table;
Symbol *current_func;
int sym_count;
int first_sym[MAX_SCOPES + 1];
int scope_depth;

void enter_scope(void) {
    if (scope_depth + 1 == MAX_SCOPES) {
        fprintf(stderr, "Maximum scope depth reached\n");
        exit(1);
    }
    scope_depth += 1;
    first_sym[scope_depth] = sym_count;
}

void leave_scope(void) {
    sym_count = first_sym[scope_depth];
    scope_depth -= 1;
}

Symbol *find_sym_within(char *name, int depth) {
    int i = sym_count - 1;
    while (i >= first_sym[depth]) {
        if (str_eq(sym_table[i]->name, name)) {
            return sym_table[i];
        }
        i -= 1;
    }
    return NULL;
}

Symbol *find_sym(char *name) {
    return find_sym_within(name, 0);
}

Symbol *mk_sym(SymKind kind, char *name) {
    Symbol *sym = calloc(1, sizeof(Symbol));
    sym->kind = kind;
    sym->name = name;
    return sym;
}

void add_sym(Symbol *sym, Pos *pos) {
    if (find_sym_within(sym->name, scope_depth)) {
        error_at(pos, "Symbol '%s' already defined", sym->name);
    }

    sym_table = realloc(sym_table, (sym_count + 1) * sizeof(Symbol *));
    sym_table[sym_count] = sym;
    sym_count += 1;
}

void add_type(char *name, Type *type, Pos *pos) {
    Symbol *sym = mk_sym(Sym_Type, name);
    sym->type = type;
    add_sym(sym, pos);
}

void add_local(char *name, Type *type, Pos *pos) {
    int offset = align_up(current_func->locals_size + type_size(type), type_align(type));

    if (offset > FRAME_LOCALS_SIZE) {
        fprintf(stderr, "Ran out of local variable space\n");
        exit(1);
    }
    current_func->locals_size = offset;

    Symbol *local = mk_sym(Sym_Local, name);
    local->type = type;
    local->frame_offset = offset;
    add_sym(local, pos);
}

void add_global(bool is_extern, char *name, Type *type, Pos *pos) {
    Symbol *global = mk_sym(Sym_Global, name);
    global->is_extern = is_extern;
    global->type = type;
    add_sym(global, pos);
}

void add_const(char *name, int value, Pos *pos) {
    Symbol *constant = mk_sym(Sym_Const, name);
    constant->type = mk_int_type(8);
    constant->value = value;
    add_sym(constant, pos);
}

bool func_eq(Symbol *a, Symbol *b) {
    assert(a->kind == Sym_Func);
    if (a->param_count != b->param_count || a->is_variadic != b->is_variadic || !type_eq(a->type, b->type))
        return false;
    for (int i = 0; i < a->param_count; i++) {
        if (!type_eq(a->param_types[i], b->param_types[i]))
            return false;
    }
    return true;
}

void add_func(Symbol *func, Pos *pos) {
    Symbol *existing = find_sym(func->name);
    if (existing && existing->kind == Sym_Func && func_eq(func, existing) && !(existing->defined && func->defined))
        return;
    add_sym(func, pos);
}

//= Abstract Syntax Tree

typedef struct Expr {
    char *kind;
    Pos pos;
    Type *type;
    // Constants
    int int_value;
    char *str_value;
    // Variables and calls
    Symbol *sym;
    // Calls and operator expressions
    struct Expr *args[MAX_PARAMS + 1];
    int arg_count;
    // Member expressions
    int field_index;
} Expr;

bool is_lvalue(Expr *expr) {
    return str_eq(expr->kind, "<var>") || str_eq(expr->kind, "*_") || str_eq(expr->kind, "_[_]") ||
           str_eq(expr->kind, "_._");
}

Expr *mk_expr(char *kind, Type *type, Pos *pos) {
    Expr *expr = calloc(1, sizeof(Expr));
    expr->kind = kind;
    expr->type = type;
    expr->pos = *pos;
    return expr;
}

Expr *mk_expr_3(char *kind, Expr *e1, Expr *e2, Expr *e3, Type *type) {
    Expr *expr = mk_expr(kind, type, &e1->pos);
    expr->args[0] = e1;
    expr->args[1] = e2;
    expr->args[2] = e3;
    return expr;
}

Expr *mk_expr_2(char *kind, Expr *e1, Expr *e2, Type *type) {
    return mk_expr_3(kind, e1, e2, NULL, type);
}

Expr *mk_expr_1(char *kind, Expr *e1, Type *type) {
    return mk_expr_2(kind, e1, NULL, type);
}

void try_coerce(Expr **expr_p, Type *target) {
    if (type_eq((*expr_p)->type, target))
        return;
    if (type_le((*expr_p)->type, target)) {
        *expr_p = mk_expr_1("as", *expr_p, target);
    } else if ((*expr_p)->type->kind == Type_Int && target->kind == Type_Int) {
        int size = ilog2((**expr_p).int_value) + 1;
        if (size < target->size) {
            *expr_p = mk_expr_1("as", *expr_p, target);
        }
    }
}

void check_type(Expr **expr_p, Type *expected) {
    try_coerce(expr_p, expected);

    if (expected->kind == Type_Ptr && expected->base->kind == Type_Void) {
        if ((*expr_p)->type->kind == Type_Ptr) {
            return;
        }
    }

    if (!type_eq((*expr_p)->type, expected)) {
        char *sb = NULL;
        pretty_type(&sb, (*expr_p)->type);
        sb_append(&sb, " != ");
        pretty_type(&sb, expected);
        error_at(&(*expr_p)->pos, "Type mismatch: %s", sb);
    }
}

void check_type_bool(Expr **expr_p) {
    check_type(expr_p, mk_bool_type());
}

void check_type_int(Expr *expr) {
    if (expr->type->kind != Type_Int) {
        error_at(&expr->pos, "Expected integer.");
    }
}

void unify_types(Expr **lhs_p, Expr **rhs_p) {
    try_coerce(rhs_p, (*lhs_p)->type);
    try_coerce(lhs_p, (*rhs_p)->type);
    check_type(rhs_p, (*lhs_p)->type);
}

//= Characters

char chr;
Pos chr_pos;

void next_char(void) {
    if (chr_pos.line == 0) {
        chr_pos.line = 1;
    }
    if (chr == '\n') {
        chr_pos.line += 1;
        chr_pos.col = 1;
    } else {
        chr_pos.col += 1;
    }
    chr = (char)getchar();
}

bool is_space(int c) {
    return c == ' ' || c == '\t' || c == '\n' || c == '\r';
}

bool is_print(int c) {
    return c >= 32 && c <= 126;
}

bool is_digit(int c) {
    return c >= '0' && c <= '9';
}

bool is_alpha(int c) {
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
}

bool is_operator(int c) {
    return c == '+' || c == '-' || c == '*' || c == '/' || c == '%' || c == '=' || c == '!' || c == '<' || c == '>' ||
           c == '&' || c == '|' || c == '.';
}

//= Tokens

enum {
    Tok_Eof,
    Tok_Int,
    Tok_Chr,
    Tok_Str,
    Tok_Wrd,
    Tok_Sym,
};

int tok;
Pos tok_pos;
char *lexeme;

void scan_char(void) {
    char c;
    if (chr == '\\') {
        next_char();
        if (chr == '0') {
            c = '\0';
        } else if (chr == 'n') {
            c = '\n';
        } else if (chr == 'r') {
            c = '\r';
        } else if (chr == 't') {
            c = '\t';
        } else if (chr == '\\') {
            c = '\\';
        } else if (chr == '\'') {
            c = '\'';
        } else if (chr == '\"') {
            c = '\"';
        } else {
            error_at(&chr_pos, "Invalid escape sequence.");
        }
    } else if (is_print(chr)) {
        c = chr;
    } else {
        error_at(&chr_pos, "Illegal character.");
    }
    sb_push(&lexeme, c);
    next_char();
}

void next_tok(void) {
    tok_pos = chr_pos;
    lexeme = NULL;
    if (chr == -1) {
        tok = Tok_Eof;
    } else if (is_space(chr)) {
        next_char();
        return next_tok();
    } else if (is_digit(chr)) {
        while (is_digit(chr)) {
            sb_push(&lexeme, chr);
            next_char();
        }
        tok = Tok_Int;
    } else if (chr == '\'') {
        next_char();
        if (chr == '\'') {
            error_at(&chr_pos, "Empty character.");
        }
        scan_char();
        if (chr != '\'') {
            error_at(&chr_pos, "Expected closing quote.");
        }
        next_char();
        tok = Tok_Chr;
    } else if (chr == '\"') {
        next_char();
        while (chr != -1 && chr != '\"') {
            scan_char();
        }
        if (chr != '\"') {
            error_at(&chr_pos, "Expected closing quote.");
        }
        next_char();
        tok = Tok_Str;
    } else if (is_alpha(chr) || chr == '_') {
        while (is_alpha(chr) || is_digit(chr) || chr == '_') {
            sb_push(&lexeme, chr);
            next_char();
        }
        tok = Tok_Wrd;
    } else if (is_operator(chr)) {
        while (is_operator(chr)) {
            sb_push(&lexeme, chr);
            next_char();
            if (str_eq(lexeme, "//")) {
                while (chr != '\n' && chr != -1) {
                    next_char();
                }
                return next_tok();
            }
        }
        tok = Tok_Sym;
    } else {
        sb_push(&lexeme, chr);
        next_char();
        tok = Tok_Sym;
    }
    sb_push(&lexeme, '\0');
}

//= Codegen

int label_count;
int temp_stack_top;

const char *strx(Type *type) {
    if (type_size(type) == 1)
        return "strb w";
    if (type_size(type) == 2)
        return "strh w";
    if (type_size(type) == 4)
        return "str w";
    if (type_size(type) == 8)
        return "str x";
    assert(false);
}

const char *ldrx(Type *type) {
    if (type->kind == Type_Bool)
        return "ldrb w";
    if (type->kind == Type_Int && type->size == 1)
        return "ldrsb x";
    if (type->kind == Type_Int && type->size == 2)
        return "ldrsh x";
    if (type->kind == Type_Int && type->size == 4)
        return "ldrsw x";
    if (type_size(type) == 8)
        return "ldr x";
    assert(false);
}

void emit_push(int reg) {
    if (temp_stack_top + 8 > FRAME_TEMP_SIZE) {
        fprintf(stderr, "Ran out of temporary space\n");
        exit(1);
    }
    temp_stack_top += 8;
    printf("  str x%d, [fp, #-%d] ; push\n", reg, FRAME_LOCALS_SIZE + temp_stack_top);
}

void emit_pop(int reg) {
    printf("  ldr x%d, [fp, #-%d] ; pop\n", reg, FRAME_LOCALS_SIZE + temp_stack_top);
    temp_stack_top -= 8;
}

void emit_arg_push(int *arg_offset, Expr *e, int reg) {
    *arg_offset += 8;
    assert(*arg_offset <= FRAME_ARGS_SIZE);
    printf("  str x%d, [sp, #%d]\n", reg, *arg_offset - 8);
}

void emit_sign_extend(Type *source, int t0, int t1) {
    assert(is_scalar(source));
    if (source->kind == Type_Int && source->size < 8) {
        char suffix = "_bh_w"[source->size];
        printf("  sxt%c x%d, w%d\n", suffix, t0, t1);
    } else {
        if (t0 != t1) {
            printf("  mov x%d, x%d\n", t0, t1);
        }
    }
}

void emit_expr(Expr *e, int t0);

void emit_lvalue(Expr *e, int t0);

void emit_operands(Expr *e, int t_lhs, int t_rhs) {
    emit_expr(e->args[0], t_lhs);
    emit_push(t_lhs);
    emit_expr(e->args[1], t_rhs);
    emit_pop(t_lhs);
}

void emit_operands_lvalue(Expr *e, int t_lhs, int t_rhs) {
    emit_lvalue(e->args[0], t_lhs);
    emit_push(t_lhs);
    emit_expr(e->args[1], t_rhs);
    emit_pop(t_lhs);
}

void emit_binary(const char *op, Expr *e, int t0) {
    emit_operands(e, 0, 1);
    printf("  %s x%d, x0, x1\n", op, t0);
}

void emit_cmp(const char *rel, Expr *e, int t0) {
    emit_operands(e, 0, 1);
    printf("  cmp x0, x1\n");
    printf("  cset x%d, %s\n", t0, rel);
}

void emit_lvalue(Expr *e, int t0) {
    if (str_eq(e->kind, "<var>") && e->sym->kind == Sym_Local) {
        const char *name = e->sym->name;
        printf("  add x%d, fp, #-%d ; &%s\n", t0, e->sym->frame_offset, name);
    } else if (str_eq(e->kind, "<var>") && e->sym->kind == Sym_Global) {
        const char *name = e->sym->name;
        if (e->sym->is_extern) {
            printf("  adrp x%d, _%s@GOTPAGE\n", t0, name);
            printf("  ldr x%d, [x%d, _%s@GOTPAGEOFF] ; &%s\n", t0, t0, name, name);
        } else {
            printf("  adrp x%d, _%s@PAGE\n", t0, name);
            printf("  add x%d, x%d, _%s@PAGEOFF ; &%s\n", t0, t0, name, name);
        }
    } else if (str_eq(e->kind, "_._")) {
        Type *lhs_type = e->args[0]->type;
        int field_offset = lhs_type->field_offsets[e->field_index];
        const char *field_name = lhs_type->field_names[e->field_index];
        emit_lvalue(e->args[0], t0);
        printf("  add x%d, x%d, #%d ; &%s\n", t0, t0, field_offset, field_name);
    } else if (str_eq(e->kind, "*_")) {
        emit_expr(e->args[0], t0);
    } else if (str_eq(e->kind, "_[_]")) {
        int t1 = t0 == 0 ? 1 : 0;
        if (e->args[0]->type->kind == Type_Ptr) {
            emit_operands(e, t0, t1);
        } else {
            emit_operands_lvalue(e, t0, t1);
        }
        printf("  lsl x%d, x%d, #%d\n", t1, t1, ilog2(type_size(e->type)));
        printf("  add x%d, x%d, x%d\n", t0, t0, t1);
    } else {
        error_at(&e->pos, "Not an lvalue.");
    }
}

void emit_expr(Expr *e, int t0) {
    if (is_lvalue(e)) {
        emit_lvalue(e, t0);
        printf("  %s%d, [x%d]\n", ldrx(e->type), t0, t0);
    } else if (str_eq(e->kind, "<int>")) {
        printf("  mov x%d, #%d\n", t0, e->int_value);
    } else if (str_eq(e->kind, "<str>")) {
        int label = label_count += 1;
        printf("  .data\n");
        printf(".str.%d:\n", label);
        printf("  .asciz \"");
        int i = 0;
        while (e->str_value[i] != '\0') {
            if (!is_print(e->str_value[i]) || e->str_value[i] == '\"') {
                printf("\\%03o", e->str_value[i]);
            } else {
                printf("%c", e->str_value[i]);
            }
            i += 1;
        }
        printf("\"\n");
        printf("  .text\n");
        printf("  adrp x%d, .str.%d@PAGE\n", t0, label);
        printf("  add x%d, x%d, .str.%d@PAGEOFF\n", t0, t0, label);
    } else if (str_eq(e->kind, "_(_)")) {
        Symbol *sym = e->sym;
        int arg_offset = 0;

        int arg_idx = 0;
        while (arg_idx < e->arg_count) {
            Expr *arg = e->args[arg_idx];
            emit_expr(arg, 0);
            if (arg_idx >= sym->param_count) {
                assert(sym->is_variadic);
                emit_arg_push(&arg_offset, arg, 0);
            } else {
                emit_push(0);
            }
            arg_idx += 1;
        }

        arg_idx = sym->param_count;
        while (arg_idx > 0) {
            emit_pop(arg_idx - 1);
            arg_idx -= 1;
        }

        printf("  bl _%s\n", sym->name);
        if (e->type->kind != Type_Void) {
            emit_sign_extend(e->type, t0, 0);
        }
    } else if (str_eq(e->kind, "&_")) {
        emit_lvalue(e->args[0], t0);
    } else if (str_eq(e->kind, "!_")) {
        emit_expr(e->args[0], t0);
        printf("  eor x%d, x%d, #1\n", t0, t0);
    } else if (str_eq(e->kind, "~_")) {
        emit_expr(e->args[0], t0);
        printf("  mvn x%d, x%d\n", t0, t0);
    } else if (str_eq(e->kind, "-_")) {
        emit_expr(e->args[0], t0);
        printf("  neg x%d, x%d\n", t0, t0);
    } else if (str_eq(e->kind, "_|_")) {
        emit_binary("orr", e, t0);
    } else if (str_eq(e->kind, "_^_")) {
        emit_binary("eor", e, t0);
    } else if (str_eq(e->kind, "_&_")) {
        emit_binary("and", e, t0);
    } else if (str_eq(e->kind, "_==_")) {
        emit_cmp("eq", e, t0);
    } else if (str_eq(e->kind, "_!=_")) {
        emit_cmp("ne", e, t0);
    } else if (str_eq(e->kind, "_<_")) {
        emit_cmp("lt", e, t0);
    } else if (str_eq(e->kind, "_<=_")) {
        emit_cmp("le", e, t0);
    } else if (str_eq(e->kind, "_>_")) {
        emit_cmp("gt", e, t0);
    } else if (str_eq(e->kind, "_>=_")) {
        emit_cmp("ge", e, t0);
    } else if (str_eq(e->kind, "_<<_")) {
        emit_binary("lsl", e, t0);
    } else if (str_eq(e->kind, "_>>_")) {
        emit_binary("lsr", e, t0);
    } else if (str_eq(e->kind, "_+_")) {
        emit_binary("add", e, t0);
    } else if (str_eq(e->kind, "_-_")) {
        emit_binary("sub", e, t0);
    } else if (str_eq(e->kind, "_*_")) {
        emit_binary("mul", e, t0);
    } else if (str_eq(e->kind, "_/_")) {
        emit_binary("sdiv", e, t0);
    } else if (str_eq(e->kind, "_%_")) {
        int t1 = t0 == 0 ? 1 : 0;
        int t2 = t0 == 2 ? 1 : 2;
        emit_operands(e, t1, t2);
        printf("  sdiv x%d, x%d, x%d\n", t0, t1, t2);
        printf("  msub x%d, x%d, x%d, x%d\n", t0, t0, t2, t1);
    } else if (str_eq(e->kind, "_?_:_")) {
        int label = label_count += 1;
        printf(".L%d.if:\n", label);
        emit_expr(e->args[0], t0);
        printf("  cmp x%d, #0\n", t0);
        printf("  cbz x%d, .L%d.else\n", t0, label);
        printf(".L%d.then:\n", label);
        emit_expr(e->args[1], t0);
        printf("  b .L%d.end\n", label);
        printf(".L%d.else:\n", label);
        emit_expr(e->args[2], t0);
        printf(".L%d.end:\n", label);
    } else if (str_eq(e->kind, "_=_") || str_eq(e->kind, "_+=_") || str_eq(e->kind, "_-=_")) {
        int t1 = t0 == 0 ? 1 : 0;
        int t2 = t0 == 2 ? 1 : 2;
        Expr *lhs = e->args[0];
        emit_operands_lvalue(e, t0, t1);
        if (str_eq(e->kind, "_+=_") || str_eq(e->kind, "_-=_")) {
            printf("  %s%d, [x%d]\n", ldrx(lhs->type), t2, t0);
            if (str_eq(e->kind, "_+=_")) {
                printf("  add x%d, x%d, x%d\n", t1, t2, t1);
            } else if (str_eq(e->kind, "_-=_")) {
                printf("  sub x%d, x%d, x%d\n", t1, t2, t1);
            } else {
                assert(false);
            }
        }
        printf("  %s%d, [x%d]\n", strx(lhs->type), t1, t0);
    } else if (str_eq(e->kind, "<memcpy>")) {
        assert(str_eq(e->args[0]->kind, "&_") && str_eq(e->args[1]->kind, "&_"));
        emit_operands(e, 0, 1);
        printf("  mov x2, #%d\n", type_size(e->args[0]->type->base));
        printf("  bl _memcpy\n");
    } else if (str_eq(e->kind, "as")) {
        Type *target = e->type;
        Type *source = e->args[0]->type;
        assert(is_scalar(target) && is_scalar(source));
        emit_expr(e->args[0], t0);
        if (target->kind == Type_Bool) {
            printf("  cmp x%d, #0\n", t0);
            printf("  cset w%d, ne\n", t0);
        } else if (type_size(target) < type_size(source)) {
            emit_sign_extend(target, t0, t0);
        } else {
            // no-op
        }
    } else {
        assert(false);
    }
}

//= Parsing

bool at(const char *str) {
    return (tok == Tok_Sym || tok == Tok_Wrd) && str_eq(lexeme, str);
}

bool eat(const char *str) {
    if (!at(str))
        return false;
    next_tok();
    return true;
}

void expect(const char *str) {
    if (!eat(str)) {
        error_at(&tok_pos, "'%s' expected.", str);
    }
}

char *p_lexeme(void) {
    char *prev_lexeme = strdup(lexeme);
    next_tok();
    return prev_lexeme;
}

char *p_ident(void) {
    if (tok != Tok_Wrd) {
        error_at(&tok_pos, "Identifier expected.");
    }
    return p_lexeme();
}

void p_comma(const char *end) {
    if (!eat(",") && !at(end)) {
        error_at(&tok_pos, "',' or '%s' expected.", end);
    }
}

int p_const_expr(void);

Type *p_type(void) {
    if (eat("(")) {
        Type *type = p_type();
        expect(")");
        return type;
    } else if (eat("Void")) {
        return mk_type(Type_Void);
    } else if (eat("Bool")) {
        return mk_bool_type();
    } else if (eat("Char") || eat("Int8")) {
        return mk_int_type(1);
    } else if (eat("Int16")) {
        return mk_int_type(2);
    } else if (eat("Int32")) {
        return mk_int_type(4);
    } else if (eat("Int") || eat("Int64")) {
        return mk_int_type(8);
    } else if (eat("*")) {
        Type *base = p_type();
        return mk_ptr_type(base);
    } else if (eat("[")) {
        Type *base = p_type();
        expect(";");
        int len = p_const_expr();
        expect("]");
        return mk_arr_type(base, len);
    } else if (tok == Tok_Wrd) {
        Symbol *sym = find_sym(lexeme);
        if (!sym) {
            error_at(&tok_pos, "Unknown type '%s'", lexeme);
        }
        if (sym->kind != Sym_Type) {
            error_at(&tok_pos, "Type expected.");
        }
        next_tok();
        return sym->type;
    } else {
        error_at(&tok_pos, "Type expected.");
    }
}

enum {
    Prec_Assign,
    Prec_Cond,
    Prec_CondOr,
    Prec_CondAnd,
    Prec_BitOr,
    Prec_BitXor,
    Prec_BitAnd,
    Prec_Cmp,
    Prec_Shift,
    Prec_Add,
    Prec_Mul,
    Prec_Cast,
    Prec_Unary,
    Prec_Postfix,
};

Expr *p_expr(int max_prec);

Expr *build_unary_expr(char *op, Expr *rhs) {
    if (str_eq(op, "*_")) {
        if (rhs->type->kind != Type_Ptr) {
            error_at(&rhs->pos, "Pointer type expected.");
        }
        return mk_expr_1("*_", rhs, rhs->type->base);
    } else if (str_eq(op, "&_")) {
        if (!is_lvalue(rhs)) {
            error_at(&rhs->pos, "Expression is not addressable.");
        }
        return mk_expr_1("&_", rhs, mk_ptr_type(rhs->type));
    } else if ((str_eq(op, "!_"))) {
        check_type_bool(&rhs);
        return mk_expr_1("!_", rhs, rhs->type);
    } else {
        check_type_int(rhs);
        return mk_expr_1(op, rhs, rhs->type);
    }
}

Expr *build_binary_expr(Expr *lhs, char *op, Expr *rhs) {
    if (str_eq(op, "_=_") || str_eq(op, "_+=_") || str_eq(op, "_-=_")) {
        if (!(is_lvalue(lhs))) {
            error_at(&lhs->pos, "Expression is not assignable.");
        }
        if (!str_eq(op, "_=_")) {
            check_type_int(lhs);
        }
        check_type(&rhs, lhs->type);
        if (!is_scalar(lhs->type)) {
            assert(is_lvalue(rhs));
            lhs = mk_expr_1("&_", lhs, mk_ptr_type(lhs->type));
            rhs = mk_expr_1("&_", rhs, mk_ptr_type(rhs->type));
            return mk_expr_2("<memcpy>", lhs, rhs, mk_type(Type_Void));
        } else {
            return mk_expr_2(op, lhs, rhs, lhs->type);
        }
    } else if (str_eq(op, "_&&_") || str_eq(op, "_||_")) {
        check_type_bool(&lhs);
        check_type_bool(&rhs);
        Expr *e = mk_expr("<int>", mk_bool_type(), &tok_pos);
        if (str_eq(op, "_&&_")) {
            e->int_value = 0;
            return mk_expr_3("_?_:_", lhs, rhs, e, rhs->type);
        } else {
            e->int_value = 1;
            return mk_expr_3("_?_:_", lhs, e, rhs, rhs->type);
        }
    } else if (str_eq(op, "_==_") || str_eq(op, "_!=_") || str_eq(op, "_<_") || str_eq(op, "_<=_") ||
               str_eq(op, "_>_") || str_eq(op, "_>=_") || str_eq(op, "_<<_")) {
        unify_types(&lhs, &rhs);
        if (!is_scalar(lhs->type)) {
            error_at(&tok_pos, "Type is not comparable.");
        }
        return mk_expr_2(op, lhs, rhs, mk_bool_type());
    } else {
        check_type_int(lhs);
        check_type_int(rhs);
        unify_types(&lhs, &rhs);
        return mk_expr_2(op, lhs, rhs, lhs->type);
    }
}

Expr *p_expr(int max_prec) {
    Expr *lhs;
    if (eat("(")) {
        lhs = p_expr(0);
        expect(")");
    } else if (eat("null")) {
        Type *type_1 = mk_ptr_type(mk_type(Type_Void));
        lhs = mk_expr("<int>", type_1, &tok_pos);
    } else if (at("true") || at("false")) {
        lhs = mk_expr("<int>", mk_bool_type(), &tok_pos);
        lhs->int_value = eat("true") || !eat("false");
    } else if (tok == Tok_Int) {
        lhs = mk_expr("<int>", mk_int_type(8), &tok_pos);
        lhs->int_value = atoi(p_lexeme());
    } else if (tok == Tok_Chr) {
        lhs = mk_expr("<int>", mk_int_type(1), &tok_pos);
        lhs->int_value = (int)p_lexeme()[0];
    } else if (tok == Tok_Str) {
        lhs = mk_expr("<str>", mk_ptr_type(mk_int_type(1)), &tok_pos);
        lhs->str_value = p_lexeme();
    } else if (eat("sizeof")) {
        lhs = mk_expr("<int>", mk_int_type(8), &tok_pos);
        expect("(");
        Type *type = p_type();
        lhs->int_value = align_up(type_size(type), type_align(type));
        expect(")");
    } else if (tok == Tok_Wrd) {
        Pos name_pos = tok_pos;
        char *name = p_ident();
        Symbol *sym = find_sym(name);
        if (!sym) {
            error_at(&name_pos, "Unknown symbol '%s'", name);
        }
        if (eat("(")) {
            if (sym->kind != Sym_Func) {
                error_at(&name_pos, "Function expected.");
            }
            lhs = mk_expr("_(_)", sym->type, &name_pos);
            lhs->sym = sym;
            while (!eat(")")) {
                Expr *arg = p_expr(0);
                p_comma(")");
                if (lhs->arg_count == MAX_PARAMS) {
                    error_at(&tok_pos, "Too many arguments provided.");
                }
                lhs->args[lhs->arg_count] = arg;
                lhs->arg_count += 1;
            }
            if (lhs->arg_count < lhs->sym->param_count) {
                error_at(&lhs->pos, "Not enough arguments provided (%d < %d)", lhs->arg_count, lhs->sym->param_count);
            } else if (lhs->arg_count > lhs->sym->param_count && !lhs->sym->is_variadic) {
                error_at(&lhs->pos, "Too many arguments provided (%d > %d)", lhs->arg_count, lhs->sym->param_count);
            }
            int i = 0;
            while (i < lhs->sym->param_count) {
                check_type(&lhs->args[i], lhs->sym->param_types[i]);
                i += 1;
            }
            while (i < lhs->arg_count) {
                if (!is_scalar(lhs->args[i]->type)) {
                    error_at(&lhs->args[i]->pos, "Invalid type for variadic argument.");
                }
                i += 1;
            }
        } else {
            if (sym->kind == Sym_Local || sym->kind == Sym_Global) {
                lhs = mk_expr("<var>", sym->type, &name_pos);
                lhs->sym = sym;
            } else if (sym->kind == Sym_Const) {
                lhs = mk_expr("<int>", sym->type, &name_pos);
                lhs->int_value = sym->value;
            } else {
                error_at(&name_pos, "Variable expected.");
            }
        }
    } else if (max_prec <= Prec_Unary && eat("*")) {
        lhs = build_unary_expr("*_", p_expr(Prec_Unary));
    } else if (max_prec <= Prec_Unary && eat("&")) {
        lhs = build_unary_expr("&_", p_expr(Prec_Unary));
    } else if (max_prec <= Prec_Unary && eat("!")) {
        lhs = build_unary_expr("!_", p_expr(Prec_Unary));
    } else if (max_prec <= Prec_Unary && eat("~")) {
        lhs = build_unary_expr("~_", p_expr(Prec_Unary));
    } else if (max_prec <= Prec_Unary && eat("-")) {
        lhs = build_unary_expr("-_", p_expr(Prec_Unary));
    } else {
        error_at(&tok_pos, "Expression expected.");
    }

    while (true) {
        if (max_prec <= Prec_Assign && eat("=")) {
            lhs = build_binary_expr(lhs, "_=_", p_expr(Prec_Assign + 1));
        } else if (max_prec <= Prec_Assign && eat("+=")) {
            lhs = build_binary_expr(lhs, "_+=_", p_expr(Prec_Assign + 1));
        } else if (max_prec <= Prec_Assign && eat("-=")) {
            lhs = build_binary_expr(lhs, "_-=_", p_expr(Prec_Assign + 1));
        } else if (max_prec <= Prec_Cond && eat("?")) {
            Expr *ift = p_expr(Prec_Cond);
            expect(":");
            Expr *iff = p_expr(Prec_Cond);
            check_type_bool(&lhs);
            unify_types(&ift, &iff);
            lhs = mk_expr_3("_?_:_", lhs, ift, iff, ift->type);
        } else if (max_prec <= Prec_CondOr && eat("||")) {
            lhs = build_binary_expr(lhs, "_||_", p_expr(Prec_CondOr + 1));
        } else if (max_prec <= Prec_CondAnd && eat("&&")) {
            lhs = build_binary_expr(lhs, "_&&_", p_expr(Prec_CondAnd + 1));
        } else if (max_prec <= Prec_BitOr && eat("|")) {
            lhs = build_binary_expr(lhs, "_|_", p_expr(Prec_BitOr + 1));
        } else if (max_prec <= Prec_BitXor && eat("^")) {
            lhs = build_binary_expr(lhs, "_^_", p_expr(Prec_BitXor + 1));
        } else if (max_prec <= Prec_BitAnd && eat("&")) {
            lhs = build_binary_expr(lhs, "_&_", p_expr(Prec_BitAnd + 1));
        } else if (max_prec <= Prec_Cmp && eat("==")) {
            lhs = build_binary_expr(lhs, "_==_", p_expr(Prec_Cmp + 1));
        } else if (max_prec <= Prec_Cmp && eat("!=")) {
            lhs = build_binary_expr(lhs, "_!=_", p_expr(Prec_Cmp + 1));
        } else if (max_prec <= Prec_Cmp && eat("<")) {
            lhs = build_binary_expr(lhs, "_<_", p_expr(Prec_Cmp + 1));
        } else if (max_prec <= Prec_Cmp && eat("<=")) {
            lhs = build_binary_expr(lhs, "_<=_", p_expr(Prec_Cmp + 1));
        } else if (max_prec <= Prec_Cmp && eat(">")) {
            lhs = build_binary_expr(lhs, "_>_", p_expr(Prec_Cmp + 1));
        } else if (max_prec <= Prec_Cmp && eat(">=")) {
            lhs = build_binary_expr(lhs, "_>=_", p_expr(Prec_Cmp + 1));
        } else if (max_prec <= Prec_Shift && eat("<<")) {
            lhs = build_binary_expr(lhs, "_<<_", p_expr(Prec_Shift + 1));
        } else if (max_prec <= Prec_Shift && eat(">>")) {
            lhs = build_binary_expr(lhs, "_>>_", p_expr(Prec_Shift + 1));
        } else if (max_prec <= Prec_Add && eat("+")) {
            lhs = build_binary_expr(lhs, "_+_", p_expr(Prec_Add + 1));
        } else if (max_prec <= Prec_Add && eat("-")) {
            lhs = build_binary_expr(lhs, "_-_", p_expr(Prec_Add + 1));
        } else if (max_prec <= Prec_Mul && eat("*")) {
            lhs = build_binary_expr(lhs, "_*_", p_expr(Prec_Mul + 1));
        } else if (max_prec <= Prec_Mul && eat("/")) {
            lhs = build_binary_expr(lhs, "_/_", p_expr(Prec_Mul + 1));
        } else if (max_prec <= Prec_Mul && eat("%")) {
            lhs = build_binary_expr(lhs, "_%_", p_expr(Prec_Mul + 1));
        } else if (max_prec <= Prec_Cast && eat("as")) {
            Type *type = p_type();
            if (!(is_scalar(type) && is_scalar(lhs->type))) {
                error_at(&tok_pos, "Invalid cast type.");
            }
            lhs = mk_expr_1("as", lhs, type);
        } else if (max_prec <= Prec_Postfix && eat("[")) {
            Expr *rhs = p_expr(0);
            expect("]");
            if (lhs->type->kind != Type_Arr && lhs->type->kind != Type_Ptr) {
                error_at(&tok_pos, "Expression is not indexable.");
            }
            check_type_int(rhs);
            lhs = mk_expr_2("_[_]", lhs, rhs, lhs->type->base);
        } else if (max_prec <= Prec_Postfix && eat(".")) {
            char *field_name = p_ident();
            if (lhs->type->kind == Type_Ptr) {
                lhs = mk_expr_1("*_", lhs, lhs->type->base);
            }
            if (lhs->type->kind != Type_Struct) {
                error_at(&tok_pos, "Expression is not a struct.");
            }
            int field_idx = find_field(lhs->type, field_name);
            if (field_idx == -1) {
                error_at(&tok_pos, "Unknown field '%s'", field_name);
            }
            lhs = mk_expr_1("_._", lhs, lhs->type->field_types[field_idx]);
            lhs->field_index = field_idx;
        } else {
            return lhs;
        }
    }
}

int const_eval(Expr *e) {
    if (str_eq(e->kind, "<int>")) {
        return e->int_value;
    } else if (str_eq(e->kind, "-_")) {
        return -const_eval(e->args[0]);
    } else if (str_eq(e->kind, "_+_")) {
        return const_eval(e->args[0]) + const_eval(e->args[1]);
    } else {
        error_at(&e->pos, "Constant evaluation failed.");
    }
}

int p_const_expr(void) {
    return const_eval(p_expr(0));
}

void p_stmt(void) {
    if (eat("{")) {
        enter_scope();
        while (!eat("}")) {
            p_stmt();
        }
        leave_scope();
    } else if (eat("var")) {
        char *name = p_ident();
        Type *type = NULL;
        if (eat(":")) {
            type = p_type();
        }
        Expr *init = NULL;
        if (eat("=")) {
            init = p_expr(0);
        }
        expect(";");

        if (type != NULL) {
            if (init != NULL) {
                check_type(&init, type);
            }
        } else {
            if (init != NULL) {
                type = init->type;
            } else {
                error_at(&tok_pos, "Type or initializer expected.");
            }
        }
        if (type_size(type) == -1) {
            error_at(&tok_pos, "Variable must have a size.");
        }

        add_local(name, type, &tok_pos);
        if (init != NULL) {
            Symbol *sym = find_sym(name);
            Expr *lhs = mk_expr("<var>", sym->type, &tok_pos);
            lhs->sym = sym;
            emit_expr(build_binary_expr(lhs, "_=_", init), 0);
        }
    } else if (eat("if")) {
        int label = label_count += 1;
        expect("(");
        Expr *expr = p_expr(0);
        expect(")");
        check_type_bool(&expr);
        printf(".L%d.if:\n", label);
        emit_expr(expr, 0);
        printf("  cbz x0, .L%d.else\n", label);
        printf(".L%d.then:\n", label);
        p_stmt();
        printf("  b .L%d.end\n", label);
        printf(".L%d.else:\n", label);
        if (eat("else")) {
            p_stmt();
        }
        printf(".L%d.end:\n", label);
    } else if (eat("while")) {
        int label = label_count += 1;
        expect("(");
        Expr *expr = p_expr(0);
        expect(")");
        check_type_bool(&expr);
        printf(".L%d.while:\n", label);
        emit_expr(expr, 0);
        printf("  cbz x0, .L%d.end\n", label);
        printf(".L%d.do:\n", label);
        p_stmt();
        printf("  b .L%d.while\n", label);
        printf(".L%d.end:\n", label);
    } else if (eat("return")) {
        if (!at(";")) {
            Expr *expr = p_expr(0);
            check_type(&expr, current_func->type);
            emit_expr(expr, 0);
        }
        expect(";");
        printf("  b .return.%s\n", current_func->name);
    } else {
        Expr *expr = p_expr(0);
        emit_expr(expr, 0);
        expect(";");
    }
}

void p_param(Symbol *func) {
    Pos start_pos = tok_pos;
    char *param_name = p_ident();
    expect(":");
    Type *param_type = p_type();
    if (func->param_count == MAX_PARAMS) {
        error_at(&start_pos, "Too many parameters.");
    }
    if (!is_scalar(param_type)) {
        error_at(&start_pos, "Invalid parameter type.");
    }
    func->param_names[func->param_count] = param_name;
    func->param_types[func->param_count] = param_type;
    func->param_count += 1;
    add_local(param_name, param_type, &start_pos);
}

Type *p_return_type(void) {
    Type *type = mk_type(Type_Void);
    if (eat(":")) {
        type = p_type();
    }
    if (type->kind != Type_Void && !is_scalar(type)) {
        error_at(&tok_pos, "Illegal return type.");
    }
    return type;
}

void emit_param_copy(void) {
    int i = 0;
    while (i < current_func->param_count) {
        Symbol *sym = find_sym(current_func->param_names[i]);
        printf("  %s%d, [fp, #-%d] ; %s\n", strx(sym->type), i, sym->frame_offset, sym->name);
        i += 1;
    }
}

void p_decl(void) {
    Pos start_pos = tok_pos;

    bool is_extern = false;
    if (eat("extern")) {
        if (!at("func") && !at("var") && !at("struct")) {
            error_at(&tok_pos, "External declaration expected.");
        }
        is_extern = true;
    }

    if (eat("func")) {
        char *name = p_ident();

        current_func = mk_sym(Sym_Func, name);
        current_func->is_extern = is_extern;
        enter_scope();

        expect("(");
        while (!at(")") && !at("...")) {
            p_param(current_func);
            p_comma(")");
        }
        if (eat("...")) {
            current_func->is_variadic = true;
        }
        expect(")");
        current_func->type = p_return_type();

        if (at("{")) {
            current_func->defined = true;
        }

        if (!is_extern && at("{")) {
            add_func(current_func, &start_pos);
            printf("  .global _%s\n", name);
            printf("_%s:\n", name);
            printf("  stp x29, x30, [sp, #-16]!\n");
            printf("  mov x29, sp\n");
            printf("  sub sp, sp, #%d\n", FRAME_SIZE);
            emit_param_copy();
            p_stmt();
            printf(".return.%s:\n", name);
            printf("  add sp, sp, #%d\n", FRAME_SIZE);
            printf("  ldp x29, x30, [sp], #16\n");
            printf("  ret\n");
        } else {
            expect(";");
        }
        leave_scope();
        add_func(current_func, &start_pos);

        current_func = NULL;
    } else if (eat("var")) {
        char *name = p_ident();
        expect(":");
        Type *type = p_type();
        expect(";");
        add_global(is_extern, name, type, &start_pos);
        if (!is_extern) {
            printf("  .globl _%s\n", name);
            printf(".zerofill __DATA,__common,_%s,%d,%d\n", name, type_size(type), type_align(type));
        }
    } else if (eat("const")) {
        char *name = p_ident();
        expect("=");
        int value = p_const_expr();
        expect(";");
        add_const(name, value, &start_pos);
    } else if (eat("struct")) {
        char *name = p_ident();
        Type *type = mk_struct_type(name);
        add_type(name, type, &start_pos);
        if (!is_extern) {
            expect("{");
            while (!eat("}")) {
                char *field_name = p_ident();
                expect(":");
                Type *field_type = p_type();
                add_field(type, field_name, field_type);
                p_comma("}");
            }
        } else {
            expect(";");
        }
    } else if (eat("enum")) {
        expect("{");

        int curr_val = 0;
        while (!eat("}")) {
            Pos name_pos = tok_pos;
            char *name = p_ident();
            if (eat("=")) {
                curr_val = p_const_expr();
            }
            p_comma("}");

            add_const(name, curr_val, &name_pos);
            curr_val += 1;
        }
    } else {
        error_at(&tok_pos, "Declaration expected.");
    }
}

int main(void) {
    next_char();
    next_tok();
    while (tok != Tok_Eof) {
        p_decl();
    }
    return 0;
}
