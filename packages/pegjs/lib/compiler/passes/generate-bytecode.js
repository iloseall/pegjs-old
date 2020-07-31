"use strict";

const util = require( "../../util" );

// Generates bytecode.
//
// Instructions
// ============
//
// Stack Manipulation
// ------------------
//
//  [0] PUSH_EMPTY_STRING
//
//        stack.push("");
//
//  [1] PUSH_UNDEFINED
//
//        stack.push(undefined);
//
//  [2] PUSH_NULL
//
//        stack.push(null);
//
//  [3] PUSH_FAILED
//
//        stack.push(FAILED);
//
//  [4] PUSH_EMPTY_ARRAY
//
//        stack.push([]);
//
//  [5] PUSH_CURR_POS
//
//        stack.push(currPos);
//
//  [6] POP
//
//        stack.pop();
//
//  [7] POP_CURR_POS
//
//        currPos = stack.pop();
//
//  [8] POP_N n
//
//        stack.pop(n);
//
//  [9] NIP
//
//        value = stack.pop();
//        stack.pop();
//        stack.push(value);
//
// [10] APPEND
//
//        value = stack.pop();
//        array = stack.pop();
//        array.push(value);
//        stack.push(array);
//
// [11] WRAP n
//
//        stack.push(stack.pop(n));
//
// [12] TEXT
//
//        stack.push(input.substring(stack.pop(), currPos));
//
// Conditions and Loops
// --------------------
//
// [13] IF t, f
//
//        if (stack.top()) {
//          interpret(ip + 3, ip + 3 + t);
//        } else {
//          interpret(ip + 3 + t, ip + 3 + t + f);
//        }
//
// [14] IF_ERROR t, f
//
//        if (stack.top() === FAILED) {
//          interpret(ip + 3, ip + 3 + t);
//        } else {
//          interpret(ip + 3 + t, ip + 3 + t + f);
//        }
//
// [15] IF_NOT_ERROR t, f
//
//        if (stack.top() !== FAILED) {
//          interpret(ip + 3, ip + 3 + t);
//        } else {
//          interpret(ip + 3 + t, ip + 3 + t + f);
//        }
//
// [16] WHILE_NOT_ERROR b
//
//        while(stack.top() !== FAILED) {
//          interpret(ip + 2, ip + 2 + b);
//        }
//
// Matching
// --------
//
// [17] MATCH_ANY a, f, ...
//
//        if (input.length > currPos) {
//          interpret(ip + 3, ip + 3 + a);
//        } else {
//          interpret(ip + 3 + a, ip + 3 + a + f);
//        }
//
// [42] MATCH_ASTRAL a, f, ...
//
//        if ((input.charCodeAt(currPos) & 0xFC00) === 0xD800 && input.length > currPos + 1 && (input.charCodeAt(currPos+1) & 0xFC00) === 0xDC00) {
//          interpret(ip + 3, ip + 3 + a);
//        } else {
//          interpret(ip + 3 + a, ip + 3 + a + f);
//        }
//
// [18] MATCH_STRING s, a, f, ...
//
//        if (input.substr(currPos, literals[s].length) === literals[s]) {
//          interpret(ip + 4, ip + 4 + a);
//        } else {
//          interpret(ip + 4 + a, ip + 4 + a + f);
//        }
//
// [19] MATCH_STRING_IC s, a, f, ...
//
//        if (input.substr(currPos, literals[s].length).toLowerCase() === literals[s]) {
//          interpret(ip + 4, ip + 4 + a);
//        } else {
//          interpret(ip + 4 + a, ip + 4 + a + f);
//        }
//
// [20] MATCH_CLASS c, a, f, ...
//
//        if (classes[c].test(input.charAt(currPos))) {
//          interpret(ip + 4, ip + 4 + a);
//        } else {
//          interpret(ip + 4 + a, ip + 4 + a + f);
//        }
//
//
// [43] MATCH_CLASS2 c, a, f, ...
//
//        if (classes[c].test(input.substring(currPos, currPos+2))) {
//          interpret(ip + 4, ip + 4 + a);
//        } else {
//          interpret(ip + 4 + a, ip + 4 + a + f);
//        }
//
// [21] ACCEPT_N n
//
//        stack.push(input.substring(currPos, n));
//        currPos += n;
//
// [22] ACCEPT_STRING s
//
//        stack.push(literals[s]);
//        currPos += literals[s].length;
//
// [23] EXPECT e
//
//        expect(expectations[e]);
//
// Calls
// -----
//
// [24] LOAD_SAVED_POS p
//
//        savedPos = stack[p];
//
// [25] UPDATE_SAVED_POS
//
//        savedPos = currPos;
//
// [26] CALL f, n, pc, p1, p2, ..., pN
//
//        value = functions[f](stack[p1], ..., stack[pN]);
//        stack.pop(n);
//        stack.push(value);
//
// Rules
// -----
//
// [27] RULE r
//
//        stack.push(parseRule(r));
//
// Failure Reporting
// -----------------
//
// [28] SILENT_FAILS_ON
//
//        silentFails++;
//
// [29] SILENT_FAILS_OFF
//
//        silentFails--;
//
// [38] EXPECT_NS_BEGIN
//
//        expected.push({ pos: curPos, variants: [] });
//
// [39] EXPECT_NS_END invert
//
//        value = expected.pop();
//        if (value.pos === expected.top().pos) {
//          if (invert) {
//            value.variants.forEach(e => { e.not = !e.not; });
//          }
//          expected.top().variants.pushAll(value.variants);
//        }
function generateBytecode( ast, session, options ) {

    const op = session.opcodes;

    const literals = [];
    const classes = [];
    const expectations = [];
    const functions = [];
    let generate;

    function addLiteralConst( value ) {

        const index = literals.indexOf( value );
        return index === -1 ? literals.push( value ) - 1 : index;

    }

    function addClassConst( node, regexp ) {

        const cls = {
            value: node.parts,
            regexp: regexp,
            inverted: node.inverted,
            ignoreCase: node.ignoreCase,
        };
        const pattern = JSON.stringify( cls.regexp );
        const index = util.findIndex( classes, c => JSON.stringify( c.regexp ) === pattern );
        return index === -1 ? classes.push( cls ) - 1 : index;

    }

    function addExpectedConst( expected ) {

        const pattern = JSON.stringify( expected );
        const index = util.findIndex( expectations, e => JSON.stringify( e ) === pattern );
        return index === -1 ? expectations.push( expected ) - 1 : index;

    }

    function addFunctionConst( predicate, params, code ) {

        const func = { predicate: predicate, params: params, body: code };
        const pattern = JSON.stringify( func );
        const index = util.findIndex( functions, f => JSON.stringify( f ) === pattern );
        return index === -1 ? functions.push( func ) - 1 : index;

    }

    const buildSequence = ( ...parts ) => [].concat( ...parts );

    function buildCondition( match, condCode, thenCode, elseCode ) {

        if ( match > 0 ) return thenCode;
        if ( match < 0 ) return elseCode;

        return condCode.concat(
            [ thenCode.length, elseCode.length ],
            thenCode,
            elseCode,
        );

    }

    function buildLoop( condCode, bodyCode ) {

        return condCode.concat( [ bodyCode.length ], bodyCode );

    }

    function buildCall( functionIndex, delta, env, sp ) {

        const params = util.values( env, value => sp - value );
        return [ op.CALL, functionIndex, delta, params.length ].concat( params );

    }

    function buildSimplePredicate( expression, negative, context ) {

        const match = expression.match|0;
        return buildSequence(
            [ op.PUSH_CURR_POS ],
            [ op.EXPECT_NS_BEGIN ],
            generate( expression, {
                sp: context.sp + 1,
                env: util.clone( context.env ),
                action: null,
                reportFailures: context.reportFailures,
            } ),
            [ op.EXPECT_NS_END, negative ? 1 : 0 ],
            buildCondition(
                negative ? -match : match,
                [ negative ? op.IF_ERROR : op.IF_NOT_ERROR ],
                buildSequence(
                    [ op.POP ],
                    [ negative ? op.POP : op.POP_CURR_POS ],
                    [ op.PUSH_UNDEFINED ],
                ),
                buildSequence(
                    [ op.POP ],
                    [ negative ? op.POP_CURR_POS : op.POP ],
                    [ op.PUSH_FAILED ],
                ),
            ),
        );

    }

    function buildSemanticPredicate( node, negative, context ) {

        const functionIndex = addFunctionConst( true, Object.keys( context.env ), node.code );

        return buildSequence(
            [ op.UPDATE_SAVED_POS ],
            buildCall( functionIndex, 0, context.env, context.sp ),
            buildCondition(
                node.match|0,
                [ op.IF ],
                buildSequence( [ op.POP ], negative ? [ op.PUSH_FAILED ] : [ op.PUSH_UNDEFINED ] ),
                buildSequence( [ op.POP ], negative ? [ op.PUSH_UNDEFINED ] : [ op.PUSH_FAILED ] ),
            ),
        );

    }

    function buildAppendLoop( expressionCode ) {

        return buildLoop(
            [ op.WHILE_NOT_ERROR ],
            buildSequence( [ op.APPEND ], expressionCode ),
        );

    }

    generate = session.buildVisitor( {
        grammar( node ) {

            node.rules.forEach( generate );
            node.literals = literals;
            node.classes = classes;
            node.expectations = expectations;
            node.functions = functions;

        },

        rule( node ) {

            node.bytecode = generate( node.expression, {
                sp: -1,                             // stack pointer
                env: { },                           // mapping of label names to stack positions
                action: null,                       // action nodes pass themselves to children here
                reportFailures: node.reportFailures, // if `false`, suppress generation of EXPECT opcodes
            } );

        },

        named( node, context ) {

            // Do not generate unused constant, if no need it
            const nameIndex = context.reportFailures ? addExpectedConst(
                { type: "rule", value: node.name },
            ) : null;
            const expressionCode = generate( node.expression, {
                sp: context.sp,
                env: context.env,
                action: context.action,
                reportFailures: false,
            } );

            // No need to disable report failures if it already disabled
            return context.reportFailures ? buildSequence(
                [ op.EXPECT, nameIndex ],
                [ op.SILENT_FAILS_ON ],
                expressionCode,
                [ op.SILENT_FAILS_OFF ],
            ) : expressionCode;

        },

        choice( node, context ) {

            function buildAlternativesCode( alternatives, context ) {

                return buildSequence(
                    generate( alternatives[ 0 ], {
                        sp: context.sp,
                        env: util.clone( context.env ),
                        action: null,
                        reportFailures: context.reportFailures,
                    } ),
                    alternatives.length < 2
                        ? []
                        : buildCondition(
                            // If alternative always match no need generate code for next alternatives
                            -( alternatives[ 0 ].match|0 ),
                            [ op.IF_ERROR ],
                            buildSequence(
                                [ op.POP ],
                                buildAlternativesCode( alternatives.slice( 1 ), context ),
                            ),
                            [],
                        ),
                );

            }

            return buildAlternativesCode( node.alternatives, context );

        },

        action( node, context ) {

            const env = util.clone( context.env );
            const emitCall = node.expression.type !== "sequence" || node.expression.elements.length === 0;
            const expressionCode = generate( node.expression, {
                sp: context.sp + ( emitCall ? 1 : 0 ),
                env: env,
                action: node,
                reportFailures: context.reportFailures,
            } );
            const match = node.expression.match|0;
            const functionIndex = emitCall && match >= 0
                ? addFunctionConst( false, Object.keys( env ), node.code )
                : null;

            return emitCall === false
                ? expressionCode
                : buildSequence(
                    [ op.PUSH_CURR_POS ],
                    expressionCode,
                    buildCondition(
                        match,
                        [ op.IF_NOT_ERROR ],
                        buildSequence(
                            [ op.LOAD_SAVED_POS, 1 ],
                            buildCall( functionIndex, 1, env, context.sp + 2 ),
                        ),
                        [],
                    ),
                    [ op.NIP ],
                );

        },

        sequence( node, context ) {

            const TOTAL_ELEMENTS = node.elements.length;

            function buildElementsCode( elements, context ) {

                if ( elements.length > 0 ) {

                    const processedCount = TOTAL_ELEMENTS - elements.slice( 1 ).length;

                    return buildSequence(
                        generate( elements[ 0 ], {
                            sp: context.sp,
                            env: context.env,
                            pluck: context.pluck,
                            action: null,
                            reportFailures: context.reportFailures,
                        } ),
                        buildCondition(
                            elements[ 0 ].match|0,
                            [ op.IF_NOT_ERROR ],
                            buildElementsCode( elements.slice( 1 ), {
                                sp: context.sp + 1,
                                env: context.env,
                                pluck: context.pluck,
                                action: context.action,
                                reportFailures: context.reportFailures,
                            } ),
                            buildSequence(
                                processedCount > 1 ? [ op.POP_N, processedCount ] : [ op.POP ],
                                [ op.POP_CURR_POS ],
                                [ op.PUSH_FAILED ],
                            ),
                        ),
                    );

                }

                if ( context.pluck.length > 0 )

                    return buildSequence(
                        [ op.PLUCK, TOTAL_ELEMENTS + 1, context.pluck.length ],
                        context.pluck.map( eSP => context.sp - eSP ),
                    );

                if ( context.action )

                    return buildSequence(
                        [ op.LOAD_SAVED_POS, TOTAL_ELEMENTS ],
                        buildCall(
                            addFunctionConst( // functionIndex
                                false,
                                Object.keys( context.env ),
                                context.action.code,
                            ),
                            TOTAL_ELEMENTS + 1,
                            context.env,
                            context.sp,
                        ),
                    );

                return buildSequence( [ op.WRAP, TOTAL_ELEMENTS ], [ op.NIP ] );

            }

            return buildSequence(
                [ op.PUSH_CURR_POS ],
                buildElementsCode( node.elements, {
                    sp: context.sp + 1,
                    env: context.env,
                    pluck: [],
                    action: context.action,
                    reportFailures: context.reportFailures,
                } ),
            );

        },

        labeled( node, context ) {

            let env = context.env;
            const label = node.label;
            const sp = context.sp + 1;

            if ( label !== null ) {

                env = util.clone( context.env );
                context.env[ label ] = sp;

            }

            if ( context.pluck && node.pick )

                context.pluck.push( sp );

            return generate( node.expression, {
                sp: context.sp,
                env: env,
                action: null,
                reportFailures: context.reportFailures,
            } );

        },

        text( node, context ) {

            return buildSequence(
                [ op.PUSH_CURR_POS ],
                generate( node.expression, {
                    sp: context.sp + 1,
                    env: util.clone( context.env ),
                    action: null,
                    reportFailures: context.reportFailures,
                } ),
                buildCondition(
                    node.expression.match|0,
                    [ op.IF_NOT_ERROR ],
                    buildSequence( [ op.POP ], [ op.TEXT ] ),
                    [ op.NIP ],
                ),
            );

        },

        simple_and( node, context ) {

            return buildSimplePredicate( node.expression, false, context );

        },

        simple_not( node, context ) {

            return buildSimplePredicate( node.expression, true, context );

        },

        optional( node, context ) {

            return buildSequence(
                generate( node.expression, {
                    sp: context.sp,
                    env: util.clone( context.env ),
                    action: null,
                    reportFailures: context.reportFailures,
                } ),
                buildCondition(
                    // If expression always match no need replace FAILED to NULL
                    -( node.expression.match|0 ),
                    [ op.IF_ERROR ],
                    buildSequence( [ op.POP ], [ op.PUSH_NULL ] ),
                    [],
                ),
            );

        },

        zero_or_more( node, context ) {

            const expressionCode = generate( node.expression, {
                sp: context.sp + 1,
                env: util.clone( context.env ),
                action: null,
                reportFailures: context.reportFailures,
            } );

            return buildSequence(
                [ op.PUSH_EMPTY_ARRAY ],
                expressionCode,
                buildAppendLoop( expressionCode ),
                [ op.POP ],
            );

        },

        one_or_more( node, context ) {

            const expressionCode = generate( node.expression, {
                sp: context.sp + 1,
                env: util.clone( context.env ),
                action: null,
                reportFailures: context.reportFailures,
            } );

            return buildSequence(
                [ op.PUSH_EMPTY_ARRAY ],
                expressionCode,
                buildCondition(
                    node.expression.match|0,
                    [ op.IF_NOT_ERROR ],
                    buildSequence( buildAppendLoop( expressionCode ), [ op.POP ] ),
                    buildSequence( [ op.POP ], [ op.POP ], [ op.PUSH_FAILED ] ),
                ),
            );

        },

        group( node, context ) {

            return generate( node.expression, {
                sp: context.sp,
                env: util.clone( context.env ),
                action: null,
                reportFailures: context.reportFailures,
            } );

        },

        semantic_and( node, context ) {

            return buildSemanticPredicate( node, false, context );

        },

        semantic_not( node, context ) {

            return buildSemanticPredicate( node, true, context );

        },

        rule_ref( node ) {

            return [ op.RULE, ast.indexOfRule( node.name ) ];

        },

        literal( node, context ) {

            if ( node.value.length > 0 ) {

                const match = node.match|0;
                const needConst = match === 0 || ( match > 0 && ! node.ignoreCase );
                const stringIndex = needConst ? addLiteralConst(
                    node.ignoreCase ? node.value.toLowerCase() : node.value,
                ) : null;
                // Do not generate unused constant, if no need it
                const expectedIndex = context.reportFailures ? addExpectedConst( {
                    type: "literal",
                    value: node.value,
                    ignoreCase: node.ignoreCase,
                } ) : null;

                // For case-sensitive strings the value must match the beginning of the
                // remaining input exactly. As a result, we can use |ACCEPT_STRING| and
                // save one |substr| call that would be needed if we used |ACCEPT_N|.
                return buildSequence(
                    context.reportFailures ? [ op.EXPECT, expectedIndex ] : [],
                    buildCondition(
                        match,
                        node.ignoreCase
                            ? [ op.MATCH_STRING_IC, stringIndex ]
                            : [ op.MATCH_STRING, stringIndex ],
                        node.ignoreCase
                            ? [ op.ACCEPT_N, node.value.length ]
                            : [ op.ACCEPT_STRING, stringIndex ],
                        [ op.PUSH_FAILED ],
                    ),
                );

            }

            return [ op.PUSH_EMPTY_STRING ];

        },

        class( node, context ) {

            const match = node.match|0;
            const match1 = node.regexp1 === null ? -1 : ( node.regexp1 === true ? 1 : match );
            const match2 = node.regexp2 === null ? -1 : ( node.regexp2 === true ? 1 : match );
            const matchD8 = node.regexp2 === null ? -1 : ( node.regexpD8 === true ? 1 : match );
            const classIndex1 = match1 === 0 ? addClassConst( node, node.regexp1 ) : null;
            const classIndex2 = match2 === 0 ? addClassConst( node, node.regexp2 ) : null;
            const inverted = node.inverted;

            // Do not generate unused constant, if no need it
            const expectedIndex = context.reportFailures ? addExpectedConst( {
                type: "class",
                value: node.parts,
                inverted: inverted,
                ignoreCase: node.ignoreCase,
            } ) : null;

            // We know here we are on a one-code-unit character
            const opcode1 = buildCondition(
                match1,
                [ op.MATCH_CLASS, classIndex1 ],
                inverted ? [ op.PUSH_FAILED ] : [ op.ACCEPT_N, 1 ],
                inverted ? [ op.ACCEPT_N, 1 ] : [ op.PUSH_FAILED ],
            );

            // Small optimisation to trigger matchD8 in the case we are in BMP mode, on a D8 followed by a DC
            // but the 2-code-units did not match, so we try with the 1-code-unit regexp1 with the knowledge
            // we are specifically on a D8 - it is not worth creating a runtime-specific regexpD8 compared to the
            // existing regexp1 (which includes the range D8).
            const opcodeD8 = buildCondition(
                matchD8,
                [ op.MATCH_CLASS, classIndex1 ],
                inverted ? [ op.PUSH_FAILED ] : [ op.ACCEPT_N, 1 ],
                inverted ? [ op.ACCEPT_N, 1 ] : [ op.PUSH_FAILED ],
            );

            // TODO This relates to "output Unicode" - see prepare-unicode-classes.js
            const opcode2FailedInverted = options.unicode ? [ op.ACCEPT_N, 2 ] : opcodeD8;
            const opcode2Failed = options.unicode ? [ op.PUSH_FAILED ] : opcodeD8;

            // We know here we are on a two-code-units character (D8 followed by DC).
            // In Unicode mode we always increment the cursor of 2 code units because we are on a non-BMP character
            //   even when we match an inverted class (=we did not find any non-BMP described in the regexp)
            // In BMP mode we increment the cursor of 2 code units when we find the 2-code-units character, but
            //   we fallback to the 1-code-unit character regexp1 (with the optimisation the first code unit is D8)
            //   where we can only increment the cursor of 1 code unit (whether we match a positive or inverted class)
            const opcode2 = buildCondition(
                match2,
                [ op.MATCH_CLASS2, classIndex2 ],
                inverted ? [ op.PUSH_FAILED ] : [ op.ACCEPT_N, 2 ],
                inverted ? opcode2FailedInverted : opcode2Failed,
            );

            // This main condition first determines if we are possibly in a 2-code-units Unicode character or a
            // 1-code-unit Unicode character.
            // In Unicode mode we always enter in this condition
            // In BMP mode we enter in this condition only if there is a 2-code-units Unicode character, else it
            //   is optimised to skip this condition and try directly the 1-code-unit Unicode character
            // TODO This relates to "input Unicode" - see prepare-unicode-classes.js
            return buildSequence(
                context.reportFailures ? [ op.EXPECT, expectedIndex ] : [],
                buildCondition(
                    options.unicode ? 0 : match2,
                    [ op.MATCH_ASTRAL ],
                    opcode2,
                    opcode1,
                ),
            );

        },

        any( node, context ) {

            // Do not generate unused constant, if no need it
            const expectedIndex = context.reportFailures
                ? addExpectedConst( { type: "any" } )
                : null;

            // TODO This relates to "output Unicode" - see prepare-unicode-classes.js
            const opcodeAccept = buildCondition(
                options.unicode ? 0 : -1,
                [ op.MATCH_ASTRAL ],
                [ op.ACCEPT_N, 2 ],
                [ op.ACCEPT_N, 1 ],
            );

            return buildSequence(
                context.reportFailures ? [ op.EXPECT, expectedIndex ] : [],
                buildCondition(
                    node.match|0,
                    [ op.MATCH_ANY ],
                    opcodeAccept,
                    [ op.PUSH_FAILED ],
                ),
            );

        },
    } );

    generate( ast );

}

module.exports = generateBytecode;
