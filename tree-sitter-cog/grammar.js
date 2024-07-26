/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

const PREC = {
  assign: 1,
  cond: 2,
  condOr: 3,
  condAnd: 4,
  bitOr: 5,
  bitXor: 6,
  bitAnd: 7,
  cmp: 8,
  shift: 9,
  add: 10,
  mul: 11,
  cast: 12,
  unary: 13,
  postfix: 14,
  primary: 15,
};

const multiplicativeOperators = ['*', '/', '%'];
const additiveOperators = ['+', '-'];
const shiftOperators = ['<<', '>>'];
const comparativeOperators = ['==', '!=', '<', '<=', '>', '>='];
const assignmentOperators = [...multiplicativeOperators, ...additiveOperators, ''].map(operator => operator + '=');

module.exports = grammar({
  name: 'cog',

  extras: $ => [
    /\s/,
    $.comment,
  ],

  supertypes: $ => [
    $._stmt,
    $._expr,
    $._type,
    $._literal,
  ],

  rules: {
    source_file: $ => repeat($._top_level_decl),

    _top_level_decl: $ => choice(
      $.include_decl,
      $.enum_decl,
      $.struct_decl,
      $.func_decl,
      $.global_decl,
      $.const_decl,
    ),

    include_decl: $ => seq(
      'include',
      field('path', $.string_literal),
      ';',
    ),

    enum_decl: $ => seq(
      'enum',
      '{',
      field('body', commaSep($.enum_member)),
      '}',
    ),

    enum_member: $ => seq(
      field('name', $.identifier),
      optional(seq(
        '=',
        field('value', ($._expr)
        )),
      )
    ),

    struct_decl: $ => seq(
      'struct',
      field('name', $.identifier),
      choice(
        field('body', optional($.struct_body)),
        ';',
      ),
    ),

    struct_body: $ => seq(
      '{',
      commaSep($.struct_member),
      '}',
    ),

    struct_member: $ => seq(
      field('name', $.identifier),
      ':',
      field('type', $._type),
    ),

    func_decl: $ => seq(
      optional('extern'),
      'func',
      field('name', $.identifier),
      field('params', $.param_list),
      optional(seq(':', field('return_type', $._type))),
      choice(
        field('body', $.block_stmt),
        ';',
      ),
    ),

    param_list: $ => seq(
      '(',
      commaSep(choice(
        $.param_decl,
        $.variadic_param,
      )),
      ')',
    ),

    param_decl: $ => seq(
      field('name', $.identifier),
      ':',
      field('type', $._type),
    ),

    variadic_param: $ => '...',

    global_decl: $ => seq(
      field('externModifier', optional('extern')),
      'var',
      field('name', $.identifier),
      ':',
      field('type', $._type),
      ';',
    ),

    const_decl: $ => seq(
      'const',
      field('name', $.identifier),
      '=',
      field('value', $._expr),
      ';',
    ),

    _type: $ => choice(
      $.grouped_type,
      $.name_type,
      $.pointer_type,
      $.array_type,
    ),

    grouped_type: $ => seq(
      '(',
      field('type', $._type),
      ')'
    ),

    name_type: $ => $.identifier,

    pointer_type: $ => seq(
      '*',
      field('pointee', $._type),
    ),

    array_type: $ => seq(
      '[',
      field('type', $._type),
      ';',
      field('size', $._expr),
      ']',
    ),

    _stmt: $ => choice(
      $.block_stmt,
      $.local_decl,
      $.if_stmt,
      $.while_stmt,
      $.return_stmt,
      $.jump_stmt,
      $.expr_stmt,
    ),


    block_stmt: $ => seq(
      '{',
      repeat($._stmt),
      '}',
    ),

    local_decl: $ => seq(
      'var',
      field('name', $.identifier),
      optional(seq(
        ':',
        field('type', $._type)
      )),
      optional(seq(
        '=',
        field('value', $._expr)
      )),
      ';',
    ),

    if_stmt: $ => prec.right(seq(
      'if',
      field('cond', $._expr),
      field('then', $._stmt),
      optional(seq(
        'else',
        field('else', $._stmt),
      )),
    )),

    while_stmt: $ => seq(
      'while',
      field('cond', $._expr),
      field('body', $._stmt),
    ),

    return_stmt: $ => seq(
      'return',
      optional($._expr),
      ';',
    ),

    jump_stmt: _ => seq(
      choice('break', 'continue'),
      ';',
    ),

    expr_stmt: $ => seq(
      $._expr,
      ';',
    ),

    _expr: $ => choice(
      $.grouped_expr,
      $.name_expr,
      $.sizeof_expr,
      $.literal_expr,
      $.binary_expr,
      $.ternary_expr,
      $.unary_expr,
      $.call_expr,
      $.index_expr,
      $.field_expr,
      $.cast_expr,
    ),

    grouped_expr: $ => seq(
      '(',
      field('expr', $._expr),
      ')'
    ),

    name_expr: $ => $.identifier,

    literal_expr: $ => $._literal,

    sizeof_expr: $ => seq(
      'sizeof',
      '(',
      field('type', $._type),
      ')',
    ),

    ternary_expr: $ => prec.right(PREC.cond, seq(
      field('cond', $._expr),
      '?',
      field('then', $._expr),
      ':',
      field('else', $._expr),
    )),

    binary_expr: $ => {
      const table = [
        [PREC.assign, choice(...assignmentOperators)],
        [PREC.condOr, '||'],
        [PREC.condAnd, '&&'],
        [PREC.bitOr, '|'],
        [PREC.bitXor, '^'],
        [PREC.bitAnd, '&'],
        [PREC.cmp, choice(...comparativeOperators)],
        [PREC.shift, choice(...shiftOperators)],
        [PREC.add, choice(...additiveOperators)],
        [PREC.mul, choice(...multiplicativeOperators)],
      ];

      return choice(...table.map(([precedence, operator]) =>
        // @ts-ignore
        prec.left(precedence, seq(
          field('left', $._expr),
          // @ts-ignore
          field('operator', operator),
          field('right', $._expr),
        )),
      ));
    },

    unary_expr: $ => prec(PREC.unary, seq(
      field('operator', choice('-', '!', '*', '&')),
      field('operand', $._expr),
    )),

    call_expr: $ => prec(PREC.primary, seq(
      field('callee', $._expr),
      '(',
      field('args', commaSep($._expr)),
      ')',
    )),

    index_expr: $ => prec(PREC.primary, seq(
      field('indexee', $._expr),
      '[',
      field('index', $._expr),
      ']',
    )),

    field_expr: $ => prec(PREC.primary, seq(
      field('left', $._expr),
      '.',
      field('name', $.identifier),
    )),

    cast_expr: $ => prec(PREC.cast, seq(
      field('expr', $._expr),
      'as',
      field('type', $._type),
    )),

    _literal: $ => choice(
      $.string_literal,
      $.char_literal,
      $.number_literal,
      $.bool_literal,
      $.null_literal,
    ),

    string_literal: _ => /"([^"\\]|\\.)*"/,

    char_literal: _ => /'([^'\\]|\\.)'/,

    number_literal: _ => token(choice(
      /\d+/,
      /\d+\.\d+/,
    )),

    bool_literal: _ => choice(
      'true',
      'false',
    ),

    null_literal: _ => 'null',

    identifier: _ => /[a-zA-Z_]\w*/,

    comment: _ => token(choice(
      seq('//', /.*/),
      seq(
        '/*',
        /[^*]*\*+([^/*][^*]*\*+)*/,
        '/',
      ),
    )),
  },
});

function commaSep(rule) {
  return optional(commaSep1(rule));
}
function commaSep1(rule) {
  return seq(repeat(seq(rule, ',')), optional(rule));
}
