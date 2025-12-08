/**
 * Reference data for the Format Reference Modal
 * Organized by sections for easy maintenance and reuse
 */

export const formatReferenceData = {
  title: '📚 Format Specifier Reference',
  
  sections: [
    {
      id: 'common-specifiers',
      title: 'Common Format Specifiers',
      type: 'table',
      columns: ['Specifier', 'Type', 'Description', 'Example'],
      rows: [
        {
          specifier: '%s',
          type: 'String',
          description: 'Any string value',
          example: '"Hello" → Hello'
        },
        {
          specifier: '%d',
          type: 'Integer',
          description: 'Whole number',
          example: '42 → 42'
        },
        {
          specifier: '%f',
          type: 'Float',
          description: 'Decimal number (default 6 decimals)',
          example: '3.14 → 3.140000'
        },
        {
          specifier: '%.2f',
          type: 'Float',
          description: 'Decimal with 2 decimal places',
          example: '3.14159 → 3.14'
        },
        {
          specifier: '%n',
          type: 'Special',
          description: 'Platform-independent newline',
          example: 'Adds line break'
        },
        {
          specifier: '%%',
          type: 'Special',
          description: 'Literal percent sign',
          example: 'Prints %'
        }
      ]
    },
    {
      id: 'width-alignment',
      title: 'Width and Alignment',
      type: 'table',
      columns: ['Format', 'Description', 'Example Input', 'Example Output'],
      rows: [
        {
          format: '%10s',
          description: 'Right-aligned in 10 spaces',
          input: '"Hi"',
          output: '"        Hi"'
        },
        {
          format: '%-10s',
          description: 'Left-aligned in 10 spaces',
          input: '"Hi"',
          output: '"Hi        "'
        },
        {
          format: '%5d',
          description: 'Right-aligned integer in 5 spaces',
          input: '42',
          output: '"   42"'
        },
        {
          format: '%05d',
          description: 'Zero-padded integer in 5 spaces',
          input: '42',
          output: '"00042"'
        },
        {
          format: '%8.2f',
          description: '8 spaces total, 2 decimals',
          input: '3.14',
          output: '"    3.14"'
        },
        {
          format: '%,d',
          description: 'Integer with thousand separators',
          input: '1000000',
          output: '"1,000,000"'
        }
      ]
    },
    {
      id: 'quick-tips',
      title: 'Quick Tips',
      type: 'list',
      items: [
        {
          bold: 'Width:',
          text: 'Number after % sets minimum width (e.g., %10s)'
        },
        {
          bold: 'Left-align:',
          text: 'Use minus sign (e.g., %-10s)'
        },
        {
          bold: 'Precision:',
          text: 'For floats, use .X (e.g., %.2f for 2 decimals)'
        },
        {
          bold: 'Zero-padding:',
          text: 'Use 0 before width (e.g., %05d)'
        },
        {
          bold: 'Grouping:',
          text: 'Use comma for thousands separator (e.g., %,d)'
        },
        {
          bold: 'Combine:',
          text: 'Mix width and precision (e.g., %8.2f)'
        }
      ]
    },
    {
      id: 'allowed-math',
      title: 'Allowed Math Functions',
      type: 'list',
      items: [
        {
          code: 'Math.round(x)',
          text: 'Round to nearest integer'
        },
        {
          code: 'Math.trunc(x)',
          text: 'Remove decimal part'
        },
        {
          code: 'Math.floor(x)',
          text: 'Round down'
        },
        {
          code: 'Math.ceil(x)',
          text: 'Round up'
        }
      ]
    }
  ]
};
