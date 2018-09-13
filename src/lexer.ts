/**
 * Agnostically lexes *most* languages into an array of guessed tokens
 *
 * This is a modified, heavily stripped down version of the `pug-lexer`,
 * adapted to the needs of this extension. The pug lexer works in a way that
 * conveniently lexes most languages, in an easily parsable way. However,
 * when I say lexes *most* languages, I mean the few I have tested.
 *
 * @see  https://github.com/pugjs/pug-lexer
 */

import {
  defaultState,
  isPunctuator,
  parse,
  parseChar,
  parseUntil,
} from 'character-parser';
import isExpression = require('is-expression');

/**
 * Represents a token object generated by the lexer
 */
export interface Lexed {
  /**
   * Represents a token's name. Usually in reference to attributes or code
   *
   * @see  `Lexer.attrs()` and `Lexer.code()`
   *
   * @var  {string}
   */
  name?: string;

  /**
   * Represent a token's tag. Usually in reference to which function the code
   * was run through
   *
   * @var  {string}
   */
  type: string;

  /**
   * Line number of code being lexed
   *
   * @var  {string}
   */
  line: number;

  /**
   * Starting column number of code being lexed
   *
   * @var  {number}
   */
  col: number;

  /**
   * Represents a token's value. Attributes and code tokens usually have this
   * property
   *
   * @var  {string | boolean}
   */
  val?: string;

  /**
   * Optional index for keeping up with array position
   */
  index?: number;

  buffer?: boolean;
  mustEscape?: boolean;
}

/**
 * Refers to range returned by character parser
 */
interface Range {
  start: number;
  end: number;
  src: string;
}

/**
 * Agnostically lexes *most* languages into an array of guessed tokens
 */
export class Lexer {
  /**
   * The input, or code, given to the lexer
   *
   * @var  {string}
   */
  public input: string;

  /**
   * List of tokens generated by the `Lexer`
   *
   * @var  {Lexer[]}
   */
  public tokens: Lexed[];

  /**
   * Current column number within `Lexer`
   *
   * @var  {number}
   */
  protected column: number;

  /**
   * Indicates whether or not the lexing process has ended
   *
   * @var  {boolean}
   */
  protected ended: boolean;

  /**
   * Current line number within `Lexer`
   *
   * @var  {number}
   */
  protected line: number;

  constructor(code: string) {
    // Throw error if code provided wasn't a string
    if (typeof code !== 'string') {
      this.error(`Expected source code to be a string but got ${typeof code}`);
    }
    // Strip any UTF-8 BOM
    code = code.replace(/^\uFEFF/, '');
    // Remove any return characters
    this.input = code.replace(/\r\n|\r/g, '\n');
    // Start at the first column and line position of the code
    this.line = 1;
    this.column = 1;
    // Initialize a blank list of tokens
    this.tokens = [];
    // Since we are just starting...
    this.ended = false;
  }

  /**
   * Return an array of tokens for the current `input`
   *
   * @returns  {Lexed[]}  List of created tokens
   */
  public getTokens(): Lexed[] {
    // Loop until the lexing is completed
    while (!this.ended) {
      this.advance();
    }
    return this.tokens;
  }

  /**
   * Calls method within `Lexed` class
   *
   * @param   {string}   func  Function name to call
   * @param   {any[]}    args  Function arguments
   *
   * @return  {boolean}        Function results
   */
  public call(func: string, ...args): boolean {
    return this[func].apply(this, arguments);
  }

  /**
   * Move to the next token
   *
   * @return  {boolean}
   */
  protected advance(): boolean | void {
    return this.call('eos')   || this.call('tag')  || this.call('code')  ||
           this.call('attrs') || this.call('text') || this.call('colon') ||
           this.fail();
  }

  /**
   * Tokenizes attributes, or function parameters
   *
   * @return  {boolean}
   */
  protected attrs(): boolean {
    // Check for an occurrence of (
    if ('(' === this.input.charAt(0)) {
      // Get starting line position
      const startingLine = this.line;
      // Push token that indicates attributes are coming
      this.tokens.push(this.tokenize('start-attributes'));
      // Remove `()` from around attributes
      const index = this.bracketExpression().end;
      const attrStr = this.input.substr(1, index - 1);
      // Increment position in input
      this.incrementColumn(1);
      // Check attribute nesting
      this.checkNesting(attrStr);
      this.consume(index + 1);
      // Expression for whitespace characters
      const whitespaceRe = /[ \n\t]/;
      // Expression for single and double quotes
      const quoteRe = /['"]/;
      // For storing quote characters
      let quote = '';
      // For mustEscape token flag
      let escapedAttr = true;
      // Defines a tokens name
      let key = '';
      // Defines token value
      let val = '';
      // Character parser default state
      let state = defaultState();
      // Initialize line as the starting line
      let line = startingLine;
      // Attribute starting column
      let columnBeginAttr = this.column;
      let columnBeginVal;
      // Indicates which of the attribute is being parsed
      let loc = 'key';
      // Checks if lexer is at the end of attributes
      const isEndOfAttribute = (j: number): boolean => {
        // If the key has not started, then the attribute cannot be ended
        if (key.trim() === '') {
          columnBeginAttr = this.column;
          return false;
        }
        // Attributes have ended if at end of attribute string
        if (j === attrStr.length) return true;
        // Check for key location
        if (loc === 'key') {
          // Test if attribute string is whitespace
          if (whitespaceRe.test(attrStr[j])) {
            // Find the first non-whitespace character
            for (let x = j; x < attrStr.length; x++) {
              if (!whitespaceRe.test(attrStr[x])) {
                // Starts a `value`
                if (attrStr[x] === '=' || attrStr[x] === '!') return false;
                // Will be handled when x === i
                else if (attrStr[x] === ',') return false;
                // Attribute ended
                else return true;
              }
            }
          }
          // If there's no whitespace and the character is not ',', the
          // attribute did not end.
          return attrStr[j] === ',';
        } else if (loc === 'value') {
          // If the character is in a string or in parentheses/brackets/braces
          if (state.isNesting() || state.isString()) return false;
          // iF the current value expression is not valid JavaScript, then
          // assume that the user did not end the value
          if (!this.checkExpression(val, true)) return false;
          // Find the first non-whitespace character
          if (whitespaceRe.test(attrStr[j])) {
            for (let x = j; x < attrStr.length; x++) {
              if (!whitespaceRe.test(attrStr[x])) {
                // If it is a JavaScript punctuator, then assume that it is part
                // of the value
                return !isPunctuator(attrStr[x]) ||
                       quoteRe.test(attrStr[x]);
              }
            }
          }
          // If there's no whitespace and the character is not ',', the
          // attribute did not end.
          return attrStr[j] === ',';
        }
      };
      // Loop of attribute characters
      for (let i = 0; i <= attrStr.length; i++) {
        // Check for end of attributes
        if (isEndOfAttribute.call(this, i)) {
          // Check for defined attribute value
          if (val.trim()) {
            // Get current column
            const saved = this.column;
            // Set column to being value column
            this.column = columnBeginVal;
            // Check if value is valid
            this.checkExpression(val);
            // Set column back to current
            this.column = saved;
          }
          // Trim trailing whitespace from value
          val = val.trim();
          // Clean attribute key value
          key = key.trim();
          key = key.replace(/^['"]|['"]$/g, '');
          // Create attribute token
          const tok = this.tokenize('attribute');
          tok.name = key;
          // Set token to true if there is no value
          tok.val = val;
          tok.col = columnBeginAttr;
          tok.mustEscape = escapedAttr;
          // Push token to list
          this.tokens.push(tok);
          // Reset local key and value for next attribute
          key = val = '';
          // Reset to key location
          loc = 'key';
          escapedAttr = false;
          // Set line position
          this.line = line;
        } else {
          // Determine which attribute token action to perform
          switch (loc) {
            case 'key-char':
              if (attrStr[i] === quote) {
                loc = 'key';
                // Check for invalid characters
                if (i + 1 < attrStr.length && !/[ ,!=\n\t]/.test(attrStr[i + 1]))
                  this.error(`Unexpected character "${attrStr[i + 1]}"
                    expected \` \`, \`\\n\`, \`\t\`, \`,\`, \`!\` or \`=\``);
              } else {
                key += attrStr[i];
              }
              break;
            case 'key':
              // Check for quotes
              if (key === '' && quoteRe.test(attrStr[i])) {
                loc = 'key-char';
                quote = attrStr[i];
              // Check if value task should be started
              } else if (attrStr[i] === '!' || attrStr[i] === '=') {
                // Determine whether or not to escape attribute
                escapedAttr = attrStr[i] !== '!';
                // Increment column if attribute character is an !
                if (attrStr[i] === '!') {
                  this.incrementColumn(1);
                  i++;
                }
                // Try error if character is not an =
                if (attrStr[i] !== '=')
                  this.error(`Unexpected character ${attrStr[i]} expected \`=\``);
                // Perform value task next
                loc = 'value';
                // Set value beginning column
                columnBeginVal = this.column + 1;
                // Set character parser state to default
                state = defaultState();
              } else {
                // Set key from attribute character
                key += attrStr[i];
              }
              break;
            case 'value':
              // Get state from current character
              state = parseChar(attrStr[i], state);
              // Set value from attribute character
              val += attrStr[i];
              break;
          }
        }
        // Check for new line
        if (attrStr[i] === '\n') {
          // Save the line number locally to keep to use at the start
          line++;
          this.column = 1;
          // If the key has not been started, update this.line immediately.
          if (!key.trim()) this.line = line;
        } else if (attrStr[i] !== undefined) {
          this.incrementColumn(1);
        }
      }
      // Reset the line numbers based on the line started on plus the number of
      // newline characters encountered
      this.line = startingLine + (attrStr.match(/\n/g) || []).length;
      // Push ending token
      this.tokens.push(this.tokenize('end-attributes'));
      // Move to the next column
      this.incrementColumn(1);
      return true;
    }
  }

  /**
   * Return the indexOf `(` or `{` or `[` / `)` or `}` or `]` delimiters.
   *
   * Make sure that when calling this function, column is at the character
   * immediately before the beginning.
   *
   * @param  {number}  skip  `this.input` position to skip too
   *
   * @return {number}
   */
  protected bracketExpression(skip?): Range {
    // If no skip value initialize to zero
    skip = skip || 0;
    // Get start from input
    const start = this.input[skip];
    // Define bracket characters
    const BRACKETS = {
      '(': ')',
      '[': ']',
      '{': '}',
    };
    // Make sure start character is a bracket
    if (Object.keys(BRACKETS).indexOf(start) < 0)
      this.error('The start character should be "(", "{" or "["');
    // Get ending bracket character
    const end = BRACKETS[start];
    // Try to get character range
    let range: Range;
    try {
      // Get character range from character parser
      range = parseUntil(this.input, end, {start: skip + 1});
    } catch (ex) {
      throw ex.message;
    }
    return range;
  }

  /**
   * Checks if given expression is a valid JavaScript
   *
   * @param   {string}   exp      Expression to check
   * @param   {boolean}  noThrow  Flag for returning false, rather than throwing
   *                              an exception
   *
   * @return  {boolean}           Try if expression is valid
   */
  protected checkExpression(exp: string, noThrow?: boolean): boolean {
    try {
      // Attempt to verify expression with `isExpression`
      this.isExpression(exp);
      return true;
    } catch (ex) {
      // Don't throw an exception
      if (noThrow) return false;
      // Exception did not come from acorn
      if (!ex.loc) throw ex;
      // Move positions
      this.incrementLine(ex.loc.line - 1);
      this.incrementColumn(ex.loc.column);
      // Throw syntax error message
      const msg = 'Syntax Error: ' + ex.message.replace(/ \([0-9]+:[0-9]+\)$/, '');
      this.error(msg);
    }
    return false;
  }

  /**
   * Create token from JavaScript code
   *
   * @return  {boolean}
   */
  protected code(): boolean {
    // Check for any code matches in input code
    const matches = /^(!?=|-)[ \t]*([^\n]+)/.exec(this.input);
    if (matches) {
      // Captured flags
      const flags = matches[1];
      // Code to tokenize
      const code = matches[2];
      // Strip token length from code input
      this.consume(matches[0].length);
      // Create code token
      const tok = this.tokenize('code', code);
      // Indicate token should be escaped?
      tok.mustEscape = flags.charAt(0) === '=';
      // Indicate token might be a JavaScript expression
      tok.buffer = flags.charAt(0) === '=' || flags.charAt(1) === '=';
      // Increment columns past the matched code
      this.incrementColumn(matches[0].length - matches[2].length);
      // Check if code is a potential JavaScript expression
      if (tok.buffer) this.checkExpression(code);
      // Push token to list
      this.tokens.push(tok);
      // Increment column based on remaining code length
      this.incrementColumn(code.length);
      return true;
    }
  }

  /**
   * Creates token based on ending color (`:`) characters
   *
   * @return  {boolean}  True if token was created otherwise false
   */
  protected colon(): boolean {
    // Scan for colon type
    const tok = this.scan(/^: +/, ':');
    // Check if token was created
    if (tok) {
      // Push token to list
      this.tokens.push(tok);
      return true;
    }
    return false;
  }

  /**
   * Checks if code is properly nested
   *
   * @param   {string}  exp  Expression to check
   *
   * @throws  Throws error message if not property nested
   *
   * @return  {void}
   */
  protected checkNesting(exp: string) {
    if (parse(exp).isNesting()) {
      this.error(`Nesting must match on expression \`${exp}\``);
    }
  }

  /**
   * Strips given number of characters from the beginning of code `input
   *
   * @param  {number}  length  Length to remove from string
   */
  protected consume(length: number) {
    this.input = this.input.substr(length);
  }

  /**
   * End of sequence
   *
   * Ends tokenization and creates a token with information about were the
   * code ends
   *
   * @return  {void}
   */
  protected eos() {
    // Make sure there is `input` left
    if (this.input.length) return;
    // Create and push end of sequence token
    this.tokens.push(this.tokenize('eos'));
    // Indicate that the tokenization has ended
    this.ended = true;
    return true;
  }

  /**
   * Throws error message with the string provided
   *
   * @param   {string}  error  Error message to throw
   *
   * @throws  Throws string provided
   *
   * @return  {void}
   */
  protected error(error: string) {
    throw error;
  }

  /**
   * Indicated the `Lexer` failed to tokenize anything
   *
   * @return  {void}
   */
  protected fail() {
    this.error(`Unexpected text "${this.input.substr(0, 5)}"`);
  }

  /**
   * Increment `this.line` and reset `this.column`.
   *
   * @param  {number}  increment
   */
  protected incrementLine(increment) {
    this.line += increment;
    if (increment) this.column = 1;
  }

  /**
   * Increment `this.column`.
   *
   * @param  {number}  increment
   */
  protected incrementColumn(increment) {
    this.column += increment;
  }

  /**
   * Checks if string is a JavaScript expression via `is-expression`
   *
   * @throws  Throws error if not an valid JavaScript expression
   *
   * @param   {string}        string  Expression to validate
   *
   * @return  {isExpression}          Results of isExpression
   */
  protected isExpression(string: string) {
    return isExpression(string, {
      throw: true,
    });
  }

  /**
   * Scan for `type` with the given regular expression
   *
   * @param   {RegExp}  regex  Expression to the scan with
   * @param   {string}  type   Type to scan for
   *
   * @return  {Lexed}
   */
  protected scan(regex: RegExp, type: string): Lexed {
    // Capture list of results based on expression provided
    const captures = regex.exec(this.input);
    // Make sure results were returned
    if (captures) {
      // Get length of matches
      const length = captures[0].length;
      // Token value
      const value = captures[1];
      // Calculate which column to move to next
      const diff = length - (value ? value.length : 0);
      // Create type token
      const tok = this.tokenize(type, value);
      // Remove scanned bit from the code provided to the Lexer
      this.consume(length);
      // Move the next column based on calculated value
      this.incrementColumn(diff);
      return tok;
    }
  }

  /**
   * Creates a tag token
   *
   * @return  {boolean}
   */
  protected tag(): boolean {
    let matches;
    // Expression define valid tag types
    const regex = /^([_\w<>?\[\]$](?:[_\-:\w<>?\[\]$]*[_\w<>?\[\]$])?)/;
    // Try to capture matches
    if (matches = regex.exec(this.input)) {
      // Set tag name
      const name = matches[1];
      // Get full match length
      const length = matches[0].length;
      // Remove matched tag from `input` code
      this.consume(length);
      // Create tag token
      const token = this.tokenize('tag', name);
      this.tokens.push(token);
      // Move columns based on match length
      this.incrementColumn(length);
      return true;
    }
  }

  /**
   * Creates text token
   *
   * @return  {boolean}
   */
  protected text(): boolean {
    // Try to create token based on expression
    const tok = this.scan(/^(?:\| ?| )([^\n]+)/, 'text') ||
      this.scan(/^\|?( )/, 'text');
    // Check token was created
    if (tok) {
      // Push text token to list
      this.tokens.push(this.tokenize('text', tok.val));
      // Increment column position
      this.incrementColumn(tok.val.length);
      return true;
    }
  }

  /**
   * Construct a token with the given `type` and `val`.
   *
   * @param   {string}  type  Token type
   * @param   {string}  val   Token value
   *
   * @return  {Lexed}         Lexed token created
   */
  protected tokenize(type: string, val?: string): Lexed {
    // Create token object. Indicate token location within the original
    // `input` string
    const token: Lexed = {
      type: type,
      line: this.line,
      col:  this.column,
    };
    // Append value to token only if provided
    if (val !== undefined)
      token.val = val;
    return token;
  }
}