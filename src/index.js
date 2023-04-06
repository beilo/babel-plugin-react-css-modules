// @flow

import {
  dirname,
  resolve,
} from 'path';
import babelPluginJsxSyntax from '@babel/plugin-syntax-jsx';
import BabelTypes from '@babel/types';
import Ajv from 'ajv';
import ajvKeywords from 'ajv-keywords';
import attributeNameExists from './attributeNameExists';
import createObjectExpression from './createObjectExpression';
import createSpreadMapper from './createSpreadMapper';
import handleSpreadClassName from './handleSpreadClassName';
import replaceJsxExpressionContainer from './replaceJsxExpressionContainer';
import requireCssModule from './requireCssModule';
import resolveStringLiteral from './resolveStringLiteral';
import optionsDefaults from './schemas/optionsDefaults';
import optionsSchema from './schemas/optionsSchema.json';

const ajv = new Ajv({
  $data: true,
});

ajvKeywords(ajv);

const validate = ajv.compile(optionsSchema);

let aliasMap: ?Map<string, string> = null;

const getTargetResourcePath = (importedPath: string, stats: *) => {
  const targetFileDirectoryPath = dirname(stats.file.opts.filename);

  if (importedPath.startsWith('.')) {
    return resolve(targetFileDirectoryPath, importedPath);
  }

  if (!importedPath.startsWith('.') && stats.opts.alias) {
    if (!aliasMap) {
      aliasMap = new Map(Object.entries(stats.opts.alias));
    }
    const aliasKey = importedPath.split('/')[0];
    if (aliasMap?.has(aliasKey)) {
      const aliasPath: string | void = aliasMap?.get(aliasKey);
      if (typeof aliasPath !== 'string') {
        throw new Error(`Cannot resolve alias path for ${importedPath}`);
      }
      return resolve(aliasPath, importedPath.replace(aliasKey, '.'));
    }
  }

  return require.resolve(importedPath);
};

const isFilenameExcluded = (filename: string, exclude: string) => filename.match(new RegExp(exclude, 'u'));

const notForPlugin = (importedPath: string, stats: *) => {
  const extension = importedPath.lastIndexOf('.') > -1
    ? importedPath.slice(importedPath.lastIndexOf('.')) : null;

  if (extension !== '.css') {
    const { filetypes } = stats.opts;
    if (!filetypes || !filetypes[extension]) return true;
  }

  const filename = getTargetResourcePath(importedPath, stats);

  if (stats.opts.exclude && isFilenameExcluded(filename, stats.opts.exclude)) {
    return true;
  }

  return false;
};

export default ({
  types,
}: {|
  types: typeof BabelTypes,
|}): { ... } => {
  const styleMapsForFileByName = {};
  const styleMapsForFileByPath = {};

  let skip = false;

  const setupFileForRuntimeResolution = (path: *, filename: string) => {
    const programPath = path.findParent((parentPath) => parentPath.isProgram());

    styleMapsForFileByName[filename].importedHelperIndentifier = programPath.scope.generateUidIdentifier('getClassName');
    styleMapsForFileByName[filename].styleModuleImportMapIdentifier = programPath.scope.generateUidIdentifier('styleModuleImportMap');

    programPath.unshiftContainer(
      'body',
      types.importDeclaration(
        [
          types.importDefaultSpecifier(
            styleMapsForFileByName[filename].importedHelperIndentifier,
          ),
        ],
        types.stringLiteral('@dr.pogodin/babel-plugin-react-css-modules/dist/browser/getClassName'),
      ),
    );

    const firstNonImportDeclarationNode = programPath.get('body').find((node) => !types.isImportDeclaration(node));

    firstNonImportDeclarationNode.insertBefore(
      types.variableDeclaration(
        'const',
        [
          types.variableDeclarator(
            types.cloneNode(
              styleMapsForFileByName[filename].styleModuleImportMapIdentifier,
            ),
            createObjectExpression(types, styleMapsForFileByName[filename].styleModuleImportMap),
          ),
        ],
      ),
    );
  };

  /**
   * Adds Webpack "hot module accept" code "a-la CommonJS" style,
   * i.e. using module.hot.
   * @param {object} path
   */
  const addCommonJsWebpackHotModuleAccept = (path: *, importedPath: string) => {
    const test = types.memberExpression(types.identifier('module'), types.identifier('hot'));
    const consequent = types.blockStatement([
      types.expressionStatement(
        types.callExpression(
          types.memberExpression(
            types.memberExpression(types.identifier('module'), types.identifier('hot')),
            types.identifier('accept'),
          ),
          [
            types.stringLiteral(importedPath),
            types.functionExpression(null, [], types.blockStatement([
              types.expressionStatement(
                types.callExpression(
                  types.identifier('require'),
                  [types.stringLiteral(importedPath)],
                ),
              ),
            ])),
          ],
        ),
      ),
    ]);

    const programPath = path.findParent((parentPath) => parentPath.isProgram());

    const firstNonImportDeclarationNode = programPath.get('body').find((node) => !types.isImportDeclaration(node));

    const hotAcceptStatement = types.ifStatement(test, consequent);

    if (firstNonImportDeclarationNode) {
      firstNonImportDeclarationNode.insertBefore(hotAcceptStatement);
    } else {
      programPath.pushContainer('body', hotAcceptStatement);
    }
  };

  /**
   * Adds Webpack "hot module accept" code "a-la ESM" style,
   * i.e. using import.meta.webpackHot
   * @param {object} path
   */
  const addEsmWebpackHotModuleAccept = (path: *, importedPath: string) => {
    const test = types.memberExpression(
      types.memberExpression(
        types.identifier('import'),
        types.identifier('meta'),
      ),
      types.identifier('webpackHot'),
    );
    const consequent = types.blockStatement([
      types.expressionStatement(
        types.callExpression(
          types.memberExpression(
            types.memberExpression(
              types.memberExpression(
                types.identifier('import'),
                types.identifier('meta'),
              ),
              types.identifier('webpackHot'),
            ),
            types.identifier('accept'),
          ),
          [
            types.stringLiteral(importedPath),
            types.functionExpression(null, [], types.blockStatement([
              types.expressionStatement(
                types.callExpression(
                  types.identifier('require'),
                  [types.stringLiteral(importedPath)],
                ),
              ),
            ])),
          ],
        ),
      ),
    ]);

    const programPath = path.findParent((parentPath) => parentPath.isProgram());

    const firstNonImportDeclarationNode = programPath.get('body').find((node) => !types.isImportDeclaration(node));

    const hotAcceptStatement = types.ifStatement(test, consequent);

    if (firstNonImportDeclarationNode) {
      firstNonImportDeclarationNode.insertBefore(hotAcceptStatement);
    } else {
      programPath.pushContainer('body', hotAcceptStatement);
    }
  };

  const loadStyleMap = (
    name: string,
    importedPath: string,
    resolvedPath: string,
    path: *,
    stats: *,
  ) => {
    const {
      file: { opts: { filename } },
      opts: {
        context,
        filetypes = {},
        generateScopedName,
        transform,
      },
    } = stats;

    const mapsByName = styleMapsForFileByName[filename].styleModuleImportMap;
    let styleMap = mapsByName[name];

    // In case it was loaded under a different name before.
    if (!styleMap) {
      styleMap = styleMapsForFileByPath[filename][importedPath];
      mapsByName[name] = styleMap;
    }

    // Loading a map for the first time.
    if (!styleMap) {
      styleMap = requireCssModule(resolvedPath, {
        context,
        filetypes,
        generateScopedName,
        transform,
      });
      mapsByName[name] = styleMap;
      styleMapsForFileByPath[filename][importedPath] = styleMap;

      const { replaceImport, webpackHotModuleReloading } = stats.opts;

      // replaceImport flag means we target server-side environment,
      // thus client-side Webpack's HMR code should not be injected.
      if (!replaceImport) {
        if (webpackHotModuleReloading === 'commonjs') {
          addCommonJsWebpackHotModuleAccept(path, importedPath);
        } else if (webpackHotModuleReloading) {
          addEsmWebpackHotModuleAccept(path, importedPath);
        }
      }
    }

    return styleMap;
  };

  return {
    inherits: babelPluginJsxSyntax,
    visitor: {
      // const styles = require('./styles.css');
      CallExpression(path: *, stats: *): void {
        const { callee: { name: calleeName }, arguments: args } = path.node;
        if (skip || calleeName !== 'require' || !args.length
          || !types.isStringLiteral(args[0])) return;

        const importedPath = args[0].value;
        if (notForPlugin(importedPath, stats)) return;

        const targetResourcePath = getTargetResourcePath(importedPath, stats);

        const isAssigned = path.parentPath.type === 'VariableDeclarator';
        const styleImportName: string = isAssigned
          ? path.parentPath.node.id.name : importedPath;

        const styleMap = loadStyleMap(
          styleImportName,
          importedPath,
          targetResourcePath,
          path,
          stats,
        );

        if (stats.opts.replaceImport) {
          if (isAssigned) {
            path.replaceWith(
              createObjectExpression(types, styleMap),
            );
          } else path.remove();
        } else if (stats.opts.removeImport) {
          path.remove();
        }
      },

      // import styles from './style.css';
      ImportDeclaration(path: *, stats: *): void {
        const importedPath = path.node.source.value;
        if (skip || notForPlugin(importedPath, stats)) return;

        const targetResourcePath = getTargetResourcePath(importedPath, stats);

        let styleImportName: string;

        if (path.node.specifiers.length === 0) {
          // use imported file path as import name
          styleImportName = importedPath;
        } else if (path.node.specifiers.length === 1) {
          styleImportName = path.node.specifiers[0].local.name;
        } else {
          // eslint-disable-next-line no-console
          console.warn('Please report your use case. https://github.com/birdofpreyru/babel-plugin-react-css-modules/issues/new?title=Unexpected+use+case.');

          throw new Error('Unexpected use case.');
        }

        const styleMap = loadStyleMap(
          styleImportName,
          importedPath,
          targetResourcePath,
          path,
          stats,
        );

        if (stats.opts.replaceImport) {
          const { specifiers } = path.node;
          if (specifiers.length) {
            if (
              specifiers.length > 1
              || specifiers[0].type !== 'ImportDefaultSpecifier'
            ) throw Error('Unsupported kind of import');

            path.replaceWith(
              types.variableDeclaration(
                'const',
                [
                  types.variableDeclarator(
                    types.identifier(specifiers[0].local.name),
                    createObjectExpression(types, styleMap),
                  ),
                ],
              ),
            );
          } else path.remove();
        } else if (stats.opts.removeImport) {
          path.remove();
        }
      },

      JSXElement(path: *, stats: *): void {
        if (skip) {
          return;
        }

        const { filename } = stats.file.opts;

        if (stats.opts.exclude && isFilenameExcluded(filename, stats.opts.exclude)) {
          return;
        }

        let { attributeNames } = optionsDefaults;

        if (stats.opts && stats.opts.attributeNames) {
          attributeNames = { ...attributeNames, ...stats.opts.attributeNames };
        }

        const attributes = path.node.openingElement.attributes
          .filter((attribute) => typeof attribute.name !== 'undefined' && typeof attributeNames[attribute.name.name] === 'string');

        if (attributes.length === 0) {
          return;
        }

        const {
          handleMissingStyleName = optionsDefaults.handleMissingStyleName,
          autoResolveMultipleImports = optionsDefaults.autoResolveMultipleImports,
        } = stats.opts || {};

        const spreadMap = createSpreadMapper(path, stats);

        attributes.forEach((attribute) => {
          const destinationName = attributeNames[attribute.name.name];

          const options = {
            autoResolveMultipleImports,
            handleMissingStyleName,
          };

          if (types.isStringLiteral(attribute.value)) {
            resolveStringLiteral(
              path,
              styleMapsForFileByName[filename].styleModuleImportMap,
              attribute,
              destinationName,
              options,
            );
          } else if (types.isJSXExpressionContainer(attribute.value)) {
            if (!styleMapsForFileByName[filename].importedHelperIndentifier) {
              setupFileForRuntimeResolution(path, filename);
            }

            replaceJsxExpressionContainer(
              types,
              path,
              attribute,
              destinationName,
              styleMapsForFileByName[filename].importedHelperIndentifier,
              types.cloneNode(styleMapsForFileByName[filename].styleModuleImportMapIdentifier),
              options,
            );
          }

          if (spreadMap[destinationName]) {
            handleSpreadClassName(
              path,
              destinationName,
              spreadMap[destinationName],
            );
          }
        });
      },

      Program(path: *, stats: *): void {
        if (!validate(stats.opts)) {
          // eslint-disable-next-line no-console
          console.error(validate.errors);

          throw new Error('Invalid configuration');
        }

        const { filename } = stats.file.opts;

        styleMapsForFileByName[filename] = {
          styleModuleImportMap: {},
        };
        styleMapsForFileByPath[filename] = {};

        if (stats.opts.skip && !attributeNameExists(path, stats)) {
          skip = true;
        }
      },
    },
  };
};
