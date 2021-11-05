// @flow

import {
  cloneNode,
  Expression,
  memberExpression,
  binaryExpression,
  conditionalExpression,
  stringLiteral,
  logicalExpression,
  identifier,
  isJSXSpreadAttribute,
} from '@babel/types';
import optionsDefaults from './schemas/optionsDefaults';

const createSpreadMapper = (path: *, stats: *): {
  [destinationName: string]: typeof Expression,
  ...
} => {
  const result = {};

  let {attributeNames} = optionsDefaults;

  if (stats.opts && stats.opts.attributeNames) {
    attributeNames = {...attributeNames, ...stats.opts.attributeNames};
  }

  const attributes = Object
    .entries(attributeNames)
    .filter((pair) => {
      return pair[1];
    });

  const attributeKeys = attributes.map((pair) => {
    return pair[0];
  });

  const spreadAttributes = path.node.openingElement.attributes
    .filter((attribute) => {
      return isJSXSpreadAttribute(attribute);
    });

  for (const spread of spreadAttributes) {
    for (const attributeKey of attributeKeys) {
      const destinationName = attributeNames[attributeKey];

      if (result[destinationName]) {
        result[destinationName] = binaryExpression(
          '+',
          result[destinationName],
          conditionalExpression(
            cloneNode(spread.argument),
            binaryExpression(
              '+',
              stringLiteral(' '),
              logicalExpression(
                '||',
                memberExpression(
                  cloneNode(spread.argument),
                  identifier(destinationName),
                ),
                stringLiteral(''),
              ),
            ),
            stringLiteral(''),
          ),
        );
      } else {
        result[destinationName] = conditionalExpression(
          cloneNode(spread.argument),
          logicalExpression(
            '||',
            memberExpression(
              cloneNode(spread.argument),
              identifier(destinationName),
            ),
            stringLiteral(''),
          ),
          stringLiteral(''),
        );
      }
    }
  }

  return result;
};

export default createSpreadMapper;
