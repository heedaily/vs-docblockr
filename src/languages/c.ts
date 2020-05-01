import { Token } from 'acorn';
import { SymbolKind } from 'vscode';

import { Parser } from '../parser';
import { Symbols } from '../symbols';

/**
 * Parses tokens for the Java language
 */
export class C extends Parser {
  /**
   * Constructs settings specific to C
   */
  constructor() {
    super({
      grammar: {
        class: [
          'struct',
          'typedef',
        ],
        function: [],
        identifier: '^[a-zA-Z_][a-zA-Z0-9_]*$',
        modifiers: [
          'unsigned',
          'signed',
          'struct',
          'static',
          'inline',
          'const',
          'auto',
          'extern',
          'complex',
        ],
        types: [
          'char',
          'double',
          'float',
          'int',
          'long',
          'short',
          'void',
        ],
        variables: [],
      },
    });
  }

  /**
   * @inheritdoc
   */
  protected parseClass(token: Token, symbols: Symbols) {
    // Check if the token represents a class identifier
    if (this.grammar.is(token.value, 'class')) {
      symbols.name = 'struct';
      symbols.type = SymbolKind.Class;

      this.done = true;

      return;
    }
  }

  /**
   * @inheritdoc
   */
  protected parseFunction(token: Token, symbols: Symbols) {
    // If an opening parenthesis occurs, assume that this token represents a
    // function
    if (token.type.label === '(') {
      symbols.type = SymbolKind.Function;
      symbols.return.type = symbols.varType;

      this.expectParameter = true;
    }
  }

  /**
   * @inheritdoc
   */
  protected parseParameters(token: Token, symbols: Symbols) {
    if (symbols.type === SymbolKind.Function && this.expectParameter) {
      // Check if a parameter type should be expected
      if (token.value && this.grammar.is(token.value, 'types') && this.expectParameter) {
        this.expectParameterType = true;

        symbols.addParameter({
          name: '',
          type: token.value,
        });
      }

      // Add the parameter name after the parameter type has been found
      if (this.expectParameterType && token.value) {
        const lastParam = symbols.getParameter(symbols.getLastParameterIndex());

        if (lastParam) {
          lastParam.name = token.value;
        }
      }

      if (token.type.label === ')') {
        this.expectParameter = false;

        return;
      }
    }

    return;
  }

  /**
   * @inheritdoc
   */
  protected parseVariable(token: Token, symbols: Symbols) {
    // Start with the assumption that a date type means the symbol is a variable
    if (this.grammar.is(token.value, 'types') && !symbols.type) {
      symbols.varType = token.value;
      symbols.type = SymbolKind.Variable;

      this.expectName = true;

      return;
    }

    // Check for a valid variable name
    if (this.expectName && this.isName(token.value)) {
      symbols.name = token.value;

      this.expectName = false;
    }
  }
}
