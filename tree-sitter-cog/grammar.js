/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

const PREC = {
  primary: 8,
  unary: 7,
  cast: 6,
  multiplicative: 5,
  additive: 4,
  comparative: 3,
  and: 2,
  or: 1,
};

const multiplicativeOperators = ['*', '/', '%', '<<', '>>', '&'];
const additiveOperators = ['+', '-', '|', '^'];
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
      '{',
      field('body', commaSep($.struct_member)),
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
        $.block_stmt,
        ';',
      ),
    ),

    param_list: $ => seq(
      '(',
      commaSep(choice(
        $.function_param,
        $.variadic_param,
      )),
      ')',
    ),

    function_param: $ => seq(
      field('name', $.identifier),
      ':',
      field('type', $._type),
    ),

    variadic_param: $ => '...',

    global_decl: $ => seq(
      optional('extern'),
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

    grouped_type: $ => seq('(', $._type, ')'),

    name_type: $ => $.identifier,

    pointer_type: $ => seq(
      '*',
      field('type', $._type),
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
      $._literal,
      $.binary_expr,
      $.unary_expr,
      $.call_expr,
      $.index_expr,
      $.field_expr,
      $.cast_expr,
    ),

    grouped_expr: $ => seq('(', $._expr, ')'),

    name_expr: $ => $.identifier,

    binary_expr: $ => {
      const table = [
        [PREC.multiplicative, choice(...multiplicativeOperators)],
        [PREC.additive, choice(...additiveOperators)],
        [PREC.comparative, choice(...comparativeOperators)],
        [PREC.and, '&&'],
        [PREC.or, '||'],
        [PREC.primary, choice(...assignmentOperators)],
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
      field('operator', choice('-', '!', '^', '*', '&')),
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

    string_literal: $ => /"([^"\\]|\\.)*"/,

    char_literal: $ => /'([^'\\]|\\.)/,

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
