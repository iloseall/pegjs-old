"use strict";

const regenerate = require( "regenerate" );

const bmp = regenerate().addRange( 0x0000, 0xFFFF );
const highSurrogates = regenerate().addRange( 0xD800, 0xDBFF );
const astral = regenerate().addRange( 0x10000, 0x10FFFF );

// node.regepxBMP and node.regexpAstral are the regular expressions associated to the class, splitted across BMP and astral planes.
function prepareUnicodeClasses( ast, session, options ) {

    session.buildVisitor( {
        class( node ) {

            if ( node.parts.length === 0 ) {

                node.regexpBMP = null;
                node.regexpAstral = null;
                return;

            }

            // TODO Should we add another distinct option to dissociate "input Unicode" from "output Unicode": "input Unicode" would be
            // the possibility to enter Unicode characters in characters classes (probably the only location where this is an issue)
            // and "output Unicode" is the fact that the rules 'dot' and 'inverted characters classes' increase the cursor of either 1
            // code unit (non-Unicode/classic mode) or 1 Unicode character (1 or 2 code units depending on the actual text)
            // This bloc relates to "input Unicode"
            if( options.unicode ) {

                for ( let i = 0; i < node.parts.length; i++ ) {

                    const part = node.parts[ i ];

                    if ( Array.isArray( part ) ) {

                        if ( ( part[ 1 ].charCodeAt( 0 ) & 0xFC00 ) === 0xD800 && part[ 1 ].length === 1 && i+1 < node.parts.length ) {

                            const nextPart = node.parts[ i+1 ];

                            if ( Array.isArray( nextPart ) ) {

                                if ( ( nextPart[ 0 ].charCodeAt( 0 ) & 0xFC00 ) === 0xDC00 ) {

                                    node.parts[ i ][ 1 ] += nextPart[ 0 ];

                                    // This looks strange but it is the behaviour of V8
                                    node.parts.splice( i+1, 1, "-", nextPart[ 1 ] );
                                    i++;

                                }

                            } else if ( ( nextPart.charCodeAt( 0 ) & 0xFC00 ) === 0xDC00 ) {

                                node.parts[ i ][ 1 ] += node.parts.splice( i+1, 1 )[ 0 ];

                            }

                        }

                    } else {

                        if ( ( part.charCodeAt( 0 ) & 0xFC00 ) === 0xD800 && part.length === 1 && i+1 < node.parts.length ) {

                            const nextPart = node.parts[ i+1 ];

                            if ( Array.isArray( nextPart ) ) {

                                if ( ( nextPart[ 0 ].charCodeAt( 0 ) & 0xFC00 ) === 0xDC00 ) {

                                    node.parts[ i+1 ][0] = part + nextPart[ 0 ];
                                    node.parts.splice( i, 1 );
                                    i--;

                                }

                            } else if ( ( nextPart.charCodeAt( 0 ) & 0xFC00 ) === 0xDC00 ) {

                                node.parts[ i ] += nextPart;
                                node.parts.splice( i+1, 1 );

                            }

                        }

                    }

                }

            } else {

                // TODO this is to forbid the use of \u{hhhhhh} in characters classes in non-Unicode mode
                // This bloc relates to "input Unicode"
                for ( let i = 0; i < node.parts.length; i++ ) {

                    const part = node.parts[ i ];

                    if ( Array.isArray( part ) ) {

                        if ( part[ 0 ].length === 2 || part[ 1 ].length === 2 ) session.error( "Invalid character in non-Unicode grammar: " + part[ 0 ] + "-" + part[ 1 ] + "." );

                    } else {

                        if ( part.length === 2 ) session.error( "Invalid character in non-Unicode grammar: " + part + "." );

                    }

                }

            }

            let regexp = regenerate();

            for ( let i = 0; i < node.parts.length; i++ ) {

                const part = node.parts[ i ];

                if ( Array.isArray( part ) ) {

                    if ( part[ 0 ].length > part[ 1 ].length ) {

                        session.error( "Invalid character range: " + part[ 0 ] + "-" + part[ 1 ] + "." );

                    } else if( part[ 0 ].length === part[ 1 ].length ) {

                        if ( part[ 0 ].charCodeAt( 0 ) > part[ 1 ].charCodeAt( 0 ) ) {

                            session.error( "Invalid character range: " + part[ 0 ] + "-" + part[ 1 ] + "." );

                        } else if ( part[ 0 ].length === 2 && part[ 0 ].charCodeAt( 1 ) > part[ 1 ].charCodeAt( 1 ) ) {

                            session.error( "Invalid character range: " + part[ 0 ] + "-" + part[ 1 ] + "." );

                        }

                    }

                    regexp.addRange( part[ 0 ], part[ 1 ] );

                } else {

                    regexp.add( part );

                }

            }

            function regexpToString( regexp, entireRange ) {

                regexp = regexp.toString( { bmpOnly: true } );

                if ( regexp === "[]" ) {

                    return null;

                } else if ( regexp === entireRange && ! node.ignoreCase ) {

                    return true;

                } else {

                    const p = ( /\|\[/ ).test( regexp );
                    return "/^" + ( p ? "(?:" : "" ) + regexp + ( p ? ")" : "" ) + "/" + ( node.ignoreCase ? "i" : "" );

                }

            }

            node.regexp1 = regexpToString( bmp.clone().intersection( regexp ), "[\\0-\\uFFFF]" );
            node.regexp2 = regexpToString( astral.clone().intersection( regexp ), "[\\uD800-\\uDBFF][\\uDC00-\\uDFFF]" );
            node.regexpD8 = regexpToString( highSurrogates.clone().intersection( regexp ), "[\\uD800-\\uDBFF]" );

            // TODO currently never triggered because of the 'options.unicode' above - could be activated if we dissociate
            // "input Unicode" from "output Unicode"
            // This relates to "input Unicode"
            if ( node.regexp2 && ! options.unicode ) {

                session.warn(
                    "Character class [" +
                    node.parts.map( function ( x ) { if ( Array.isArray( x ) ) return x[0] + "-" + x[1]; else return x; } ).join( "," ) +
                    "] contains Unicode characters outside of BMP: these will never matched; you should set options.unicode to true.",
                );

            }

        },
    } )( ast );

}

module.exports = prepareUnicodeClasses;
