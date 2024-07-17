; Types

(name_type) @type

; Functions

(call_expr
  callee: (name_expr) @function)
(func_decl
  name: (identifier) @function)

; Keywords

[
  (bool_literal)
  (null_literal)
] @constant.builtin

[
    "break"
    "const"
    "continue"
    "else"
    "enum"
    "extern"
    "false"
    "func"
    "if"
    "include"
    "return"
    "struct"
    "true"
    "var"
    "var"
    "while"
] @keyword
