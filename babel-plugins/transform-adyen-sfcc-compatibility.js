'use strict';

module.exports = function transformAdyenSfccCompatibility({
    types: t
}) {
    const generatedNamesByScope = new WeakMap();

    function clone(node) {
        return t.cloneNode(node, true);
    }

    function createUndefinedCheck(identifier) {
        return t.binaryExpression('===', clone(identifier), t.identifier('undefined'));
    }

    /**
     * Detects optional chains inside concise arrow bodies where declarations
     * cannot safely be hoisted outside the arrow scope.
     */
    function isInsideConciseArrowBody(path) {
        const functionPath = path.getFunctionParent();

        return Boolean(functionPath && functionPath.isArrowFunctionExpression() && !t.isBlockStatement(functionPath.node.body));
    }

    /**
     * Converts SFCC collection for...of loops to iterator loops.
     *
     * Example:
     *   for (var item of collection.toArray()) { ... }
     *   -> var iterator = collection.iterator();
     *      while (iterator.hasNext()) { var item = iterator.next(); ... }
     */
    function transformForOfToIterator(path) {
        const left = path.node.left;
        const right = path.node.right;

        if (!t.isVariableDeclaration(left) || left.declarations.length !== 1) {
            throw path.buildCodeFrameError('Readable for...of transform requires a single ' + 'variable declaration.');
        }

        const itemDeclaration = left.declarations[0];

        if (!t.isIdentifier(itemDeclaration.id)) {
            throw path.buildCodeFrameError('Readable for...of transform requires an ' + 'identifier loop variable.');
        }

        if (
            !t.isCallExpression(right) ||
            !t.isMemberExpression(right.callee) ||
            right.callee.computed ||
            !t.isIdentifier(right.callee.property, {
                name: 'toArray'
            })
        ) {
            throw path.buildCodeFrameError('Readable for...of transform only supports ' + 'SFCC collections ending in .toArray().');
        }

        const itemIdentifier = clone(itemDeclaration.id);

        const iteratorIdentifier = path.scope.generateUidIdentifier(`${itemIdentifier.name}Iterator`);

        const iteratorDeclaration = t.variableDeclaration('var', [
            t.variableDeclarator(
                clone(iteratorIdentifier),
                t.callExpression(t.memberExpression(clone(right.callee.object), t.identifier('iterator')), [])
            )
        ]);

        const currentItemDeclaration = t.variableDeclaration('var', [
            t.variableDeclarator(clone(itemIdentifier), t.callExpression(t.memberExpression(clone(iteratorIdentifier), t.identifier('next')), []))
        ]);

        const originalBody = t.isBlockStatement(path.node.body) ? clone(path.node.body) : t.blockStatement([clone(path.node.body)]);

        originalBody.body.unshift(currentItemDeclaration);

        const whileStatement = t.whileStatement(
            t.callExpression(t.memberExpression(clone(iteratorIdentifier), t.identifier('hasNext')), []),
            originalBody
        );

        t.inheritsComments(iteratorDeclaration, path.node);

        path.replaceWithMultiple([iteratorDeclaration, whileStatement]);
    }

    /** Returns true when an explicit `= undefined` default can be removed. */
    function isRemovableParameterDefault(node) {
        return t.isIdentifier(node) && node.name === 'undefined';
    }

    /**
     * Converts function defaults to explicit undefined checks.
     *
     * Example:
     *   function fn(value = 'default') {}
     *   -> function fn(value) { if (value === undefined) value = 'default'; }
     *
     * null, '', 0, and false are preserved.
     */
    function transformDefaultParameters(path) {
        const initializationStatements = [];
        let changed = false;

        path.node.params = path.node.params.map((parameter) => {
            if (!t.isAssignmentPattern(parameter)) {
                return parameter;
            }

            if (!t.isIdentifier(parameter.left)) {
                throw path.buildCodeFrameError('Default parameters using destructuring are not ' + 'supported by the readable parameter transform.');
            }

            changed = true;

            const identifier = clone(parameter.left);
            const defaultValue = clone(parameter.right);

            /*
             * An explicit undefined default requires no replacement
             * statement after the AssignmentPattern is removed.
             *
             *     function example(value = undefined) {}
             *
             * becomes:
             *
             *     function example(value) {}
             */
            if (!isRemovableParameterDefault(defaultValue)) {
                initializationStatements.push(
                    t.ifStatement(
                        createUndefinedCheck(identifier),
                        t.blockStatement([t.expressionStatement(t.assignmentExpression('=', clone(identifier), defaultValue))])
                    )
                );
            }

            return identifier;
        });

        if (!changed || initializationStatements.length === 0) {
            return;
        }

        /*
         * A concise arrow function has an expression body, so convert it
         * into a block before inserting the initialization statements.
         *
         * Example:
         *
         *     (value = 'default') => value
         *
         * becomes:
         *
         *     (value) => {
         *         if (value === undefined) {
         *             value = 'default';
         *         }
         *
         *         return value;
         *     }
         */
        if (path.isArrowFunctionExpression() && !t.isBlockStatement(path.node.body)) {
            path.node.body = t.blockStatement([...initializationStatements, t.returnStatement(clone(path.node.body))]);

            return;
        }

        if (!t.isBlockStatement(path.node.body)) {
            throw path.buildCodeFrameError('Cannot insert readable default-parameter logic into ' + 'a function without a block body.');
        }

        path.node.body.body.unshift(...initializationStatements);
    }


    /** Prepends generated defaults to a for-in/for-of body once per iteration. */
    function prependStatementsToLoopBody(
        loopPath,
        statements
    ) {
        const bodyPath =
            loopPath.get('body');

        if (bodyPath.isBlockStatement()) {
            bodyPath.unshiftContainer(
                'body',
                statements
            );

            return;
        }

        bodyPath.replaceWith(
            t.blockStatement([
                ...statements.map(clone),
                clone(bodyPath.node)
            ])
        );
    }

    /**
     * Removes defaults from object destructuring and inserts equivalent checks.
     *
     * Example:
     *   var { quantity = 1 } = source;
     *   -> var { quantity } = source;
     *      if (quantity === undefined) quantity = 1;
     */
    function transformObjectDestructuringDefaults(path) {
        const defaultStatements = [];
        let changed = false;

        path.node.declarations.forEach((declaration) => {
            if (!t.isObjectPattern(declaration.id)) {
                return;
            }

            declaration.id.properties.forEach((property) => {
                if (!t.isObjectProperty(property) || !t.isAssignmentPattern(property.value)) {
                    return;
                }

                const assignment = property.value;

                if (!t.isIdentifier(assignment.left)) {
                    throw path.buildCodeFrameError('Destructuring defaults must use an identifier.');
                }

                changed = true;

                const identifier = clone(assignment.left);
                const defaultValue = clone(assignment.right);

                /*
                 * Keep the destructuring property but remove the
                 * unsupported default assignment.
                 */
                property.value = clone(identifier);
                property.shorthand = !property.computed && t.isIdentifier(property.key) && property.key.name === identifier.name;

                /*
                 * An explicit undefined default produces the same result
                 * after the unsupported assignment syntax is removed.
                 */
                if (isRemovableParameterDefault(defaultValue)) {
                    return;
                }

                /*
                 * Preserve native JavaScript default semantics. The
                 * fallback is applied only when the extracted value is
                 * undefined, not when it is null, empty, zero, or false.
                 */
                defaultStatements.push(
                    t.ifStatement(
                        createUndefinedCheck(identifier),
                        t.blockStatement([t.expressionStatement(t.assignmentExpression('=', clone(identifier), defaultValue))])
                    )
                );
            });
        });

        if (!changed || defaultStatements.length === 0) {
            return;
        }

        const parentPath = path.parentPath;

        /*
         * The left side of for-in and for-of is evaluated once per
         * iteration. Defaults must therefore run at the start of every
         * iteration.
         */
        if (
            (
                parentPath.isForInStatement() ||
                parentPath.isForOfStatement()
            ) &&
            parentPath.node.left === path.node
        ) {
            prependStatementsToLoopBody(
                parentPath,
                defaultStatements
            );

            return;
        }

        /*
         * A classic for-loop initializer runs once before the first test.
         * Moving defaults into the loop body would change evaluation timing,
         * so reject this rare unsupported form rather than emit incorrect
         * code.
         */
        if (
            parentPath.isForStatement() &&
            parentPath.node.init === path.node
        ) {
            throw path.buildCodeFrameError(
                'Object destructuring defaults in a classic ' +
                'for-loop initializer are not supported.'
            );
        }

        path.insertAfter(defaultStatements);
    }

    /** Removes Adyen copyright/license header comments. */
    function removeAdyenHeader(comments) {
        if (!comments) {
            return comments;
        }

        return comments.filter((comment) => {
            const value = comment.value;

            const isAdyenHeader = value.includes('Adyen Salesforce Commerce Cloud') && value.includes('Copyright') && value.includes('LICENSE');

            return !isAdyenHeader;
        });
    }

    /** Removes Adyen headers attached throughout a file AST. */
    function removeAdyenHeaders(path) {
        if (path.node.comments) {
            path.node.comments = removeAdyenHeader(path.node.comments);
        }

        path.traverse({
            enter(childPath) {
                if (childPath.node.leadingComments) {
                    childPath.node.leadingComments = removeAdyenHeader(childPath.node.leadingComments);
                }

                if (childPath.node.innerComments) {
                    childPath.node.innerComments = removeAdyenHeader(childPath.node.innerComments);
                }

                if (childPath.node.trailingComments) {
                    childPath.node.trailingComments = removeAdyenHeader(childPath.node.trailingComments);
                }
            }
        });
    }

    /**
     * Returns whether the parent continues the current member/call chain.
     * Example: `basket?.getPrice().isAvailable()` is one chain.
     */
    function parentContinuesChain(path) {
        const parent = path.parentPath;

        if (!parent) {
            return false;
        }

        if ((parent.isOptionalMemberExpression() || parent.isMemberExpression()) && parent.node.object === path.node) {
            return true;
        }

        if ((parent.isOptionalCallExpression() || parent.isCallExpression()) && parent.node.callee === path.node) {
            return true;
        }

        return false;
    }

    /** Returns the outermost member/call path in an optional chain. */
    function getOutermostChainPath(path) {
        let current = path;

        while (parentContinuesChain(current)) {
            current = current.parentPath;
        }

        return current;
    }

    /**
     * Returns whether an enclosing if already guards the optional-chain base.
     * Example: `if (items) { items?.forEach(callback); }`
     */
    function isGuardedByEnclosingIf(path, base) {
        let currentPath = path;

        while (currentPath.parentPath) {
            const parentPath = currentPath.parentPath;

            if (parentPath.isIfStatement() && parentPath.node.consequent === currentPath.node && t.isNodesEquivalent(parentPath.node.test, base)) {
                return true;
            }

            currentPath = parentPath;
        }

        return false;
    }

    /** Returns whether node is an `(object || {})` fallback for base. */
    function isObjectFallbackForBase(node, base) {
        return (
            t.isLogicalExpression(node, {
                operator: '||'
            }) &&
            t.isNodesEquivalent(node.left, base) &&
            t.isObjectExpression(node.right) &&
            node.right.properties.length === 0
        );
    }

    /** Returns whether an expression establishes that the optional-chain base exists. */
    function expressionGuardsBase(node, base) {
        if (t.isNodesEquivalent(node, base)) {
            return true;
        }

        if (t.isMemberExpression(node) || t.isOptionalMemberExpression(node)) {
            if (isObjectFallbackForBase(node.object, base)) {
                return true;
            }

            return expressionGuardsBase(node.object, base);
        }

        if (
            t.isLogicalExpression(node, {
                operator: '&&'
            })
        ) {
            return expressionGuardsBase(node.left, base) || expressionGuardsBase(node.right, base);
        }

        return false;
    }

    /**
     * Returns whether the left side of an enclosing && already guards base.
     * Example: `(item || {}).values && item?.values.indexOf(value) > -1`.
     */
    function isGuardedByLeftSideOfLogicalAnd(path, base) {
        let currentPath = path;

        while (currentPath.parentPath) {
            const parentPath = currentPath.parentPath;

            if (
                parentPath.isLogicalExpression({
                    operator: '&&'
                }) &&
                parentPath.node.right === currentPath.node &&
                expressionGuardsBase(parentPath.node.left, base)
            ) {
                return true;
            }

            currentPath = parentPath;
        }

        return false;
    }

    /** Returns whether the optional-chain base is already guarded. */
    function isAlreadyGuarded(path, base) {
        return isGuardedByEnclosingIf(path, base) || isGuardedByLeftSideOfLogicalAnd(path, base);
    }

    /** Returns whether repeated evaluation could repeat a function call. */
    function containsCallExpression(node) {
        if (t.isCallExpression(node) || t.isOptionalCallExpression(node)) {
            return true;
        }

        if (t.isMemberExpression(node) || t.isOptionalMemberExpression(node)) {
            return containsCallExpression(node.object);
        }

        if (t.isLogicalExpression(node)) {
            return containsCallExpression(node.left) || containsCallExpression(node.right);
        }

        if (t.isConditionalExpression(node)) {
            return containsCallExpression(node.test) || containsCallExpression(node.consequent) || containsCallExpression(node.alternate);
        }

        return false;
    }


    /**
     * Converts accessor names to readable lower-camel-case result names.
     * Examples: getProfile -> profile; getAbsURL -> absURL; getID -> id.
     */
    function normalizeAccessorName(methodName) {
        let value = methodName;

        if (
            value.length > 3 &&
            value.indexOf('get') === 0 &&
            value.charAt(3) ===
                value.charAt(3).toUpperCase()
        ) {
            value = value.substring(3);
        } else if (
            value.length > 2 &&
            value.indexOf('is') === 0 &&
            value.charAt(2) ===
                value.charAt(2).toUpperCase()
        ) {
            value = value.substring(2);
        }

        /*
        * Normalize a completely uppercase accessor result.
        *
        *     ID   -> id
        *     URL  -> url
        *     UUID -> uuid
        */
        if (/^[A-Z0-9]+$/.test(value)) {
            return value.toLowerCase();
        }

        /*
        * Normalize a leading acronym while preserving the remaining
        * camel-case portion.
        *
        *     URLValue  -> urlValue
        *     UUIDValue -> uuidValue
        */
        value = value.replace(
            /^[A-Z]+(?=[A-Z][a-z])/,
            (prefix) => prefix.toLowerCase()
        );

        /*
        * Normalize ordinary PascalCase accessor results.
        *
        *     Profile          -> profile
        *     PaymentMethod    -> paymentMethod
        *     PaymentProcessor -> paymentProcessor
        *     AbsURL           -> absURL
        *     CustomerID       -> customerID
        */
        return (
            value.charAt(0).toLowerCase() +
            value.substring(1)
        );
    }

    /** Returns generated names reserved in the current function/program scope. */
    function getGeneratedNamesForScope(path) {
        const ownerScope =
            path.scope.getFunctionParent() ||
            path.scope.getProgramParent();

        if (!generatedNamesByScope.has(ownerScope)) {
            generatedNamesByScope.set(
                ownerScope,
                new Set()
            );
        }

        return generatedNamesByScope.get(
            ownerScope
        );
    }

    /** Returns whether a name conflicts with source, global, or generated bindings. */
    function isIdentifierNameUnavailable(
        path,
        name
    ) {
        const generatedNames =
            getGeneratedNamesForScope(path);

        return (
            path.scope.hasBinding(name) ||
            path.scope.hasGlobal(name) ||
            generatedNames.has(name)
        );
    }

    /** Reserves a generated identifier in the current function/program scope. */
    function reserveGeneratedName(
        path,
        name
    ) {
        getGeneratedNamesForScope(path).add(
            name
        );
    }

    /** Returns a readable name hint for an optional-chain temporary. */
    function getTemporaryNameHint(expression) {
        if (
            !t.isCallExpression(expression) ||
            !t.isMemberExpression(
                expression.callee
            ) ||
            expression.callee.computed ||
            !t.isIdentifier(
                expression.callee.property
            )
        ) {
            return 'optionalChainValue';
        }

        return normalizeAccessorName(
            expression.callee.property.name
        );
    }

    /**
     * Ensures declarations can be inserted before a statement, wrapping
     * single-statement if/loop bodies in a block when necessary.
     */
    function ensureStatementListPath(
        path,
        statementPath
    ) {
        if (statementPath.inList) {
            return statementPath;
        }

        const parentPath =
            statementPath.parentPath;

        const isSingleStatementBody =
            (
                parentPath.isIfStatement() &&
                (
                    parentPath.node.consequent ===
                        statementPath.node ||
                    parentPath.node.alternate ===
                        statementPath.node
                )
            ) ||
            (
                (
                    parentPath.isForStatement() ||
                    parentPath.isForInStatement() ||
                    parentPath.isForOfStatement() ||
                    parentPath.isWhileStatement() ||
                    parentPath.isDoWhileStatement() ||
                    parentPath.isWithStatement()
                ) &&
                parentPath.node.body ===
                    statementPath.node
            );

        if (!isSingleStatementBody) {
            throw path.buildCodeFrameError(
                'Could not create a statement-list container ' +
                'for an optional-chain temporary.'
            );
        }

        statementPath.replaceWith(
            t.blockStatement([
                clone(statementPath.node)
            ])
        );

        return statementPath.get('body.0');
    }

    /** Returns the safe statement path before which a temporary can be declared. */
    function getTemporaryDeclarationTarget(path) {
        const statementPath =
            path.getStatementParent();

        if (!statementPath) {
            throw path.buildCodeFrameError(
                'Could not find a containing statement for an ' +
                'optional-chain temporary.'
            );
        }

        return ensureStatementListPath(
            path,
            statementPath
        );
    }

    /** Declares a collision-safe temporary before the containing statement. */
    function createChainTemporary(
        path,
        expression
    ) {
        const identifier =
            createReadableIdentifier(
                path,
                getTemporaryNameHint(expression)
            );

        const declaration =
            t.variableDeclaration('var', [
                t.variableDeclarator(
                    clone(identifier),
                    null
                )
            ]);

        const targetPath =
            getTemporaryDeclarationTarget(path);

        targetPath.insertBefore(
            declaration
        );

        return identifier;
    }

    /**
     * Caches a call-based optional receiver so it is evaluated once.
     * Example: `customer?.getProfile()?.getWallet()` caches `getProfile()`.
     */
    function cacheIntermediateExpression(path, expression) {
        const identifier = createChainTemporary(path, expression);

        return {
            guardExpression: t.assignmentExpression('=', clone(identifier), clone(expression)),
            currentExpression: clone(identifier)
        };
    }

    /** Flattens a member/call chain into a base and ordered operations. */
    function flattenChain(node) {
        if (t.isOptionalMemberExpression(node) || t.isMemberExpression(node)) {
            const chain = flattenChain(node.object);

            chain.operations.push({
                type: 'member',
                property: clone(node.property),
                computed: Boolean(node.computed),
                optional: Boolean(node.optional)
            });

            return chain;
        }

        if (t.isOptionalCallExpression(node) || t.isCallExpression(node)) {
            const chain = flattenChain(node.callee);

            chain.operations.push({
                type: 'call',
                arguments: node.arguments.map(clone),
                optional: Boolean(node.optional)
            });

            return chain;
        }

        return {
            base: clone(node),
            operations: []
        };
    }

    /** Applies one member or call operation to an expression. */
    function applyOperation(current, operation) {
        if (operation.type === 'member') {
            return t.memberExpression(clone(current), clone(operation.property), operation.computed);
        }

        if (operation.type === 'call') {
            return t.callExpression(clone(current), operation.arguments.map(clone));
        }

        throw new Error(`Unsupported optional-chain operation: ${operation.type}`);
    }

    /** Returns a readable name for a generated chain result. */
    function getExpressionNameHint(expression) {
        let propertyName = null;

        if (
            t.isCallExpression(expression) &&
            t.isMemberExpression(
                expression.callee
            ) &&
            !expression.callee.computed &&
            t.isIdentifier(
                expression.callee.property
            )
        ) {
            propertyName =
                expression.callee.property.name;
        } else if (
            t.isMemberExpression(expression) &&
            !expression.computed &&
            t.isIdentifier(expression.property)
        ) {
            propertyName =
                expression.property.name;
        }

        if (!propertyName) {
            return 'optionalChainValue';
        }

        if (
            propertyName.indexOf('get') === 0 ||
            propertyName.indexOf('is') === 0
        ) {
            return normalizeAccessorName(
                propertyName
            );
        }

        if (t.isCallExpression(expression)) {
            return `${propertyName}Result`;
        }

        return propertyName;
    }

    /** Creates a readable collision-safe identifier, suffixing on conflicts. */
    function createReadableIdentifier(
        path,
        nameHint
    ) {
        if (
            !isIdentifierNameUnavailable(
                path,
                nameHint
            )
        ) {
            reserveGeneratedName(
                path,
                nameHint
            );

            return t.identifier(nameHint);
        }

        let suffix = 2;
        let candidate =
            `${nameHint}${suffix}`;

        while (
            isIdentifierNameUnavailable(
                path,
                candidate
            )
        ) {
            suffix += 1;
            candidate =
                `${nameHint}${suffix}`;
        }

        reserveGeneratedName(
            path,
            candidate
        );

        return t.identifier(candidate);
    }

    /** Creates the identifier used for an optional-chain segment result. */
    function createResultIdentifier(path, expression) {
        return createReadableIdentifier(path, getExpressionNameHint(expression));
    }

    /** Inserts generated declarations before the containing statement. */
    function insertDeclarationsBeforeStatement(
        path,
        declarations
    ) {
        if (!declarations.length) {
            return;
        }

        const statementPath =
            path.getStatementParent();

        if (!statementPath) {
            throw path.buildCodeFrameError(
                'Could not find a containing statement for ' +
                'readable optional-chain declarations.'
            );
        }

        const insertionTarget =
            ensureStatementListPath(
                path,
                statementPath
            );

        insertionTarget.insertBefore(
            declarations
        );
    }

    /** Returns whether this operation starts a new optional-chain segment. */
    function startsOptionalSegment(operation) {
        return Boolean(operation.optional);
    }

    /**
     * Splits a flattened chain at optional boundaries.
     * Example: `customer?.getProfile()?.getWallet()` -> two call segments.
     */
    function splitIntoOptionalSegments(operations) {
        const leadingOperations = [];
        const segments = [];
        let currentSegment = null;

        operations.forEach((operation) => {
            if (startsOptionalSegment(operation)) {
                currentSegment = {
                    operations: []
                };

                segments.push(currentSegment);
            }

            if (currentSegment) {
                currentSegment.operations.push(operation);
            } else {
                leadingOperations.push(operation);
            }
        });

        return {
            leadingOperations,
            segments
        };
    }

    /** Applies one optional segment as ordinary operations. */
    function applySegmentOperations(receiver, operations) {
        return operations.reduce((current, operation) => {
            return applyOperation(
                current,
                Object.assign({}, operation, {
                    optional: false
                })
            );
        }, clone(receiver));
    }

    /** Returns whether the chain result is ignored as a complete expression statement. */
    function isIgnoredExpressionResult(path) {
        return Boolean(
            path.parentPath &&
            path.parentPath.isExpressionStatement() &&
            path.parentPath.node.expression ===
                path.node
        );
    }

    /**
     * Returns whether a call-based chain can become readable declarations.
     * Excludes boolean contexts, concise arrows, and ignored results.
     */
    function canBuildReadableCallDeclarations(
        path,
        base,
        operations
    ) {
        const hasCall =
            t.isCallExpression(base) ||
            operations.some(
                (operation) =>
                    operation.type === 'call'
            );

        if (!hasCall) {
            return false;
        }

        /*
        * Do not generate result variables for calls whose result is ignored.
        *
        * Example:
        *
        *     fileReader?.close();
        *
        * should become:
        *
        *     fileReader &&
        *         fileReader.close();
        */
        if (isIgnoredExpressionResult(path)) {
            return false;
        }

        /*
        * Conditions in loops and similar constructs may need to be evaluated
        * repeatedly.
        */
        if (isBooleanChainContext(path)) {
            return false;
        }

        /*
        * Do not insert declarations before a concise arrow function. The
        * optional chain may reference parameters that exist only inside the
        * arrow.
        */
        if (isInsideConciseArrowBody(path)) {
            return false;
        }

        return Boolean(
            path.getStatementParent()
        );
    }

    /**
     * Converts call-based optional chains into guarded declarations.
     * Example: `customer?.getProfile()?.getWallet()` -> `profile`, then `wallet`.
     */
    function buildReadableCallDeclarations(path, base, operations) {
        const parts = splitIntoOptionalSegments(operations);

        let receiver = clone(base);
        const declarations = [];

        /*
         * Apply any normal operations that occur before the first optional
         * boundary.
         */
        if (parts.leadingOperations.length) {
            receiver = applySegmentOperations(receiver, parts.leadingOperations);
        }

        /*
         * A call expression used as the base must be evaluated once before
         * it is used as an optional receiver.
         *
         * Example:
         *
         *     PaymentMgr.getPaymentMethod(...)?.getProcessor()
         */
        if (t.isCallExpression(receiver) && parts.segments.length) {
            const baseIdentifier = createResultIdentifier(path, receiver);

            declarations.push(t.variableDeclaration('var', [t.variableDeclarator(clone(baseIdentifier), clone(receiver))]));

            receiver = clone(baseIdentifier);
        }

        parts.segments.forEach((segment) => {
            const segmentValue = applySegmentOperations(receiver, segment.operations);

            const resultIdentifier = createResultIdentifier(path, segmentValue);

            const initializer = t.logicalExpression('&&', clone(receiver), clone(segmentValue));

            declarations.push(t.variableDeclaration('var', [t.variableDeclarator(clone(resultIdentifier), initializer)]));

            receiver = clone(resultIdentifier);
        });

        insertDeclarationsBeforeStatement(path, declarations);

        return receiver;
    }

    /** Returns whether the optional chain is consumed directly as a boolean test. */
    function isBooleanChainContext(path) {
        const parent = path.parentPath;

        if (!parent) {
            return false;
        }

        if (
            (parent.isIfStatement() || parent.isWhileStatement() || parent.isDoWhileStatement() || parent.isConditionalExpression()) &&
            parent.node.test === path.node
        ) {
            return true;
        }

        if (parent.isForStatement() && parent.node.test === path.node) {
            return true;
        }

        if (
            parent.isUnaryExpression({
                operator: '!'
            })
        ) {
            return true;
        }

        return false;
    }

    /** Returns whether the optional portion contains only property reads suitable for `{}` fallbacks. */
    function canUseObjectFallback(operations) {
        const firstOptionalIndex = operations.findIndex((operation) => operation.optional);

        if (firstOptionalIndex === -1) {
            return false;
        }

        return operations.slice(firstOptionalIndex).every((operation) => operation.type === 'member' && operation.optional);
    }

    /**
     * Builds `{}` fallbacks for property-only optional chains.
     * Example: `JSON.parse(data).installments?.value` -> `(JSON.parse(data).installments || {}).value`.
     */
    function buildObjectFallbackChain(base, operations) {
        let current = clone(base);

        operations.forEach((operation) => {
            if (operation.type === 'member') {
                const receiver = operation.optional ? t.logicalExpression('||', clone(current), t.objectExpression([])) : clone(current);

                current = t.memberExpression(receiver, clone(operation.property), operation.computed);

                return;
            }

            /*
             * Calls are allowed before the first optional property.
             * canUseObjectFallback() ensures that no calls occur after
             * the optional portion begins.
             */
            current = applyOperation(current, operation);
        });

        return current;
    }

    /** Builds the readable && form, caching call-based receivers when needed. */
    function buildAndChain(path, base, operations) {
        let current = clone(base);
        const expressions = [];

        operations.forEach((operation) => {
            if (operation.optional) {
                if (containsCallExpression(current)) {
                    const cached = cacheIntermediateExpression(path, current);

                    expressions.push(cached.guardExpression);

                    current = cached.currentExpression;
                } else {
                    expressions.push(clone(current));
                }
            }

            current = applyOperation(current, operation);
        });

        if (expressions.length === 0) {
            return current;
        }

        /*
         * If there is only one guard and an earlier condition already
         * establishes that the base exists, emitting the same base guard
         * again is unnecessary.
         */
        if (
            expressions.length === 1 &&
            isAlreadyGuarded(path, base) &&
            !t.isAssignmentExpression(
                expressions[0]
            )
        ) {
            return current;
        }

        expressions.push(current);

        return expressions.reduce((result, expression) => {
            if (!result) {
                return clone(expression);
            }

            return t.logicalExpression('&&', result, clone(expression));
        }, null);
    }

    /** Selects object fallback, readable declarations, or an && chain. */
    function buildLogicalChain(path, node) {
        const {
            base,
            operations
        } = flattenChain(node);

        if (canUseObjectFallback(operations) && !isBooleanChainContext(path)) {
            return buildObjectFallbackChain(base, operations);
        }

        if (canBuildReadableCallDeclarations(path, base, operations)) {
            return buildReadableCallDeclarations(path, base, operations);
        }

        return buildAndChain(path, base, operations);
    }

    /** Replaces one complete optional chain with its compatible representation. */
    function transformChain(path) {
        const outermostPath = getOutermostChainPath(path);

        const replacement = buildLogicalChain(outermostPath, outermostPath.node);

        t.inheritsComments(replacement, outermostPath.node);

        outermostPath.replaceWith(replacement);
    }

    /** Converts `Object.hasOwn(object, key)` to the prototype `hasOwnProperty.call` form. */
    function transformObjectHasOwn(path) {
        const callee = path.node.callee;

        if (
            !t.isMemberExpression(callee) ||
            callee.computed ||
            !t.isIdentifier(callee.object, {
                name: 'Object'
            }) ||
            !t.isIdentifier(callee.property, {
                name: 'hasOwn'
            })
        ) {
            return;
        }

        /*
         * Do not transform Object.hasOwn() when Object is a locally
         * declared variable or function parameter.
         */
        if (path.scope.getBinding('Object')) {
            return;
        }

        if (path.node.arguments.length !== 2) {
            throw path.buildCodeFrameError('Object.hasOwn() must have exactly two arguments.');
        }

        const objectArgument = clone(path.node.arguments[0]);

        const propertyArgument = clone(path.node.arguments[1]);

        path.replaceWith(
            t.callExpression(
                t.memberExpression(
                    t.memberExpression(t.memberExpression(t.identifier('Object'), t.identifier('prototype')), t.identifier('hasOwnProperty')),
                    t.identifier('call')
                ),
                [objectArgument, propertyArgument]
            )
        );
    }

    return {
        name: 'transform-adyen-sfcc-compatibility',

        manipulateOptions(_options, parserOpts) {
            parserOpts.plugins = parserOpts.plugins || [];

            if (!parserOpts.plugins.includes('optionalChaining')) {
                parserOpts.plugins.push('optionalChaining');
            }
        },

        visitor: {
            Program: {
                enter(path) {
                    removeAdyenHeaders(path);

                    const directives = path.node.directives || [];

                    const alreadyStrict = directives.some((directive) => directive.value.value === 'use strict');

                    if (!alreadyStrict) {
                        directives.unshift(t.directive(t.directiveLiteral('use strict')));

                        path.node.directives = directives;
                    }
                }
            },

            VariableDeclaration: {
                exit(path) {
                    transformObjectDestructuringDefaults(path);
                }
            },

            OptionalMemberExpression: {
                enter(path) {
                    transformChain(path);
                }
            },

            OptionalCallExpression: {
                enter(path) {
                    transformChain(path);
                }
            },

            Function: {
                enter(path) {
                    transformDefaultParameters(path);
                }
            },

            ForOfStatement: {
                exit(path) {
                    transformForOfToIterator(path);
                }
            },

            CallExpression: {
                exit(path) {
                    transformObjectHasOwn(path);
                }
            }
        }
    };
};