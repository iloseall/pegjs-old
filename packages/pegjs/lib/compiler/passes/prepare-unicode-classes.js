"use strict";

const regenerate = require( "regenerate" );

// node.codeUnits is a static analysis of the number of UTF-16 code units associated to each class. Can be:
//    1: the class is statically determined as 1 code unit (BMP or lone surrogates) 
//    2: the class is statically determined as 2 code units (all astral code points)
//    "dynamic": the class is statically determined as 1 or 2 code units depending on the parsed text during execution
// node.regepx is the regular expression associated to the class.
function prepareUnicodeClasses( ast, session, options ) {

    session.buildVisitor( {
        class( node ) {

            if ( node.parts.length === 0 ) {

                node.codeUnits = 1;
                node.regexp = "[]";
                return;

            }

            let minCodeUnits = 2;
            let maxCodeUnits = 1;
            let highSurrogate = false;
            let lowSurrogate = false;
            let bmp = false;
            let astral = false;
            let regexp = regenerate();

            function minmax( part ) {

                const code = part.charCodeAt( 0 );

                if ( part.length === 1 ) {

                    minCodeUnits = 1;

                    if ( ( code & 0xFC00 ) === 0xD800 ) {

                        highSurrogate = true;

                    } else if ( ( code & 0xFC00 ) === 0xDC00 ) {

                        lowSurrogate = true;

                    } else {

                        bmp = true;

                    }

                } else {

                    maxCodeUnits = 2;
                    astral = true;

                }

            }

            for ( let i = 0; i < node.parts.length; i++ ) {

                const part = node.parts[ i ];

                if ( Array.isArray( part ) ) {

                    minmax( part[ 0 ] );
                    minmax( part[ 1 ] );
                    regexp.addRange( part[ 0 ], part[ 1 ] );

                } else {

                    minmax( part );
                    regexp.add( part );

                }

            }

            if ( maxCodeUnits === 2 && ! options.unicode ) {

                session.error(
                    `Unicode characters above the BMP cannot be used in classes when options.unicode is false.`,
                    node.location,
                );

            }

            if ( highSurrogate || lowSurrogate ) {

                if ( bmp || astral ) {

                    session.error(
                        `UTF-16 surrogates cannot be used together with well-formed Unicode characters in the same class.`,
                        node.location,
                    );

                }

                if ( highSurrogate && lowSurrogate ) {

                    session.error(
                        `UTF-16 high surrogates cannot be used together with low surrogates in the same class.`,
                        node.location,
                    );

                }

                if ( options.unicode === true ) {

                    session.error(
                        `UTF-16 surrogates cannot be used when options.unicode is true, meaning well-formed Unicode characters only.`,
                        node.location,
                    );

                }

                if ( node.inverted || node.ignoreCase ) {

                    session.error(
                        `UTF-16 surrogages cannot be used in an inverted class or in a class with the ignoreCase flag.`,
                        node.location,
                    );

                }

            }

            if ( node.inverted ) {

                if ( options.unicode ) {

                    regexp = regenerate().addRange( 0, 0x10FFFF ).remove( regexp );
                    maxCodeUnits = 2;

                } else {

                    regexp = regenerate().addRange( 0, 0xFFFF ).remove( regexp );

                }

            }

            regexp = regexp.toString()
                .replace( "|[\\uD800-\\uDBFF](?![\\uDC00-\\uDFFF])", "" )
                .replace( "|(?:[^\\uD800-\\uDBFF]|^)[\\uDC00-\\uDFFF]", "" );
            const multipleClasses = ( /\|\[/ ).test( regexp );

            node.codeUnits = minCodeUnits === maxCodeUnits ? minCodeUnits : "dynamic";
            node.regexp = "/^"
                + ( multipleClasses ? "(?:" : "" )
                + regexp
                + ( multipleClasses ? ")" : "" )
                + "/"
                + ( node.ignoreCase ? "i" : "" );

        },
    } )( ast );

}

module.exports = prepareUnicodeClasses;
