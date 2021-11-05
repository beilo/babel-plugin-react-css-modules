// @flow

import optionsDefaults from './schemas/optionsDefaults';

const attributeNameExists = (programPath: *, stats: *): boolean => {
  let exists = false;

  let {attributeNames} = optionsDefaults;

  if (stats.opts && stats.opts.attributeNames) {
    attributeNames = {...attributeNames, ...stats.opts.attributeNames};
  }

  programPath.traverse({
    JSXAttribute (attributePath: *) {
      if (exists) {
        return;
      }

      const attribute = attributePath.node;

      if (typeof attribute.name !== 'undefined' && typeof attributeNames[attribute.name.name] === 'string') {
        exists = true;
      }
    },
  });

  return exists;
};

export default attributeNameExists;
