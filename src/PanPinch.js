import React from 'react';
import { StyleSheet, View } from 'react-native';
import { DangerZone, GestureHandler } from 'expo';

const { PanGestureHandler, PinchGestureHandler, State } = GestureHandler;

const { Animated } = DangerZone;
// console.log = () => {};

const {
    event,
    set,
    Value,
    cond,
    multiply,
    eq,
    add,
    min,
    max,
    debug,
    block,
    greaterOrEq,
    sub,
    // greaterThan,
    // pow,
    divide,
} = Animated;


/**
 * Caps a value if it exceeds minValue or maxValue
 * @param  {Number|Value} minValue Lower boundary
 * @param  {Number|Value} maxValue Upper boundary
 * @param  {Number|Value} value    Current value
 * @return {Animated.Node}
 */
function cap(minValue, maxValue, value) {
    return min(maxValue, max(minValue, value));
}


/**
 * Scales/moves object given to the user's interaction; if it extends range, has a spring-like
 * extension (slows down and sticks slightly to allowed boundaries)
 * @param {Number|Value} minValue       Minimum boundary that shouldn't be exceeded
 * @param {Number|Value} maxValue       Maximum boundary that shouldn't be exceeded
 * @param {Number|Value} value          Current value
 * @return {Animated.Node}
 */
/* function bounce(minValue, maxValue, value) {

    // Span between minValue and maxValue
    const boundaryDiff = sub(maxValue, minValue);
    // Always use relative bounce effect (for panning and pinching) – don't slow down by pixels
    // but by percentage user extends over boundaries, where percentage is measured by how much
    // (current value - minValue) exceeds the *boundaryDiff*.
    const exceedsHighRelatively = divide(
        sub(value, minValue),
        boundaryDiff,
    );
    // If we're below minValue, exceedsLowRelatively is above 1!
    const exceedsLowRelatively = divide(
        sub(maxValue, value),
        boundaryDiff,
    );
    const exceedsHigh = sub(value, maxValue);
    const exceedsLow = sub(minValue, value);

    return cond(
        greaterThan(exceedsHigh, 0),

        // We're exceeding the upper boundary:
        // Just multiply boundaryDiff with a spring-like variable then add minValue to it.
        // Why can we not just multiply maxValue with spring-like variable? Because maxValue might
        // be 0.
        add(
            multiply(
                boundaryDiff,
                // 4th root of exceedsHighRelatively
                pow(exceedsHighRelatively, 0.25),
            ),
            minValue,
        ),

        cond(
            greaterThan(exceedsLow, 0),

            // We're exceeding the lower boundary:
            // Multiply boundaryDiff with a spring-like variable then remove it from maxValue.
            // Why can we not just multiply minValue with spring-like variable? Because minValue
            // might be 0.
            sub(
                maxValue,
                multiply(
                    boundaryDiff,
                    // 4th root of exceedsLowRelatively
                    pow(exceedsLowRelatively, 0.25),
                ),
            ),
            value,
        ),
    );
} */



/**
 * Resulting translation is calculated in the same way for x and y dimensions; this function
 * returns the necessary logic
 * @param  {Value} previousTranslation
 * @param  {Value} currentTranslation
 * @param  {State} gestureState
 * @param  {Animated.Node} operation        Reanimated operation that is used to convert previous
 *                                          to next value (e.g. multiply, add)
 * @param {Number[]} boundaries             Values that should not be exceeded by next value, in
 *                                          the form of [min, max]
 * @return {Animated.Node}
 */
function updateTranslation(
    previousTranslation,
    currentTranslation,
    gestureState,
    boundaries = [-1, 1],
    operation = add, // add or multiply
    defaultValue = 0, // 0 for additions, 1 for multiplications
) {
    return cond(
        eq(gestureState, State.END),

        // State.END:
        // - update previous: add current, but don't exceed boundaries
        // - re-set current to base (initial value; needed because next state will be BEGAN and
        //   current will be added to/multiplied with previous again)
        // - return (updated) previous
        [
            set(
                previousTranslation,
                cap(
                    boundaries[0],
                    boundaries[1],
                    operation(
                        previousTranslation,
                        currentTranslation,
                    ),
                ),
            ),
            set(currentTranslation, defaultValue),
            previousTranslation,
        ],

        // State.ACTIVE or State.BEGAN etc: calculate and return current value, use spring-like
        // effect if boundaries are exceeded
        // TODO: Replace with bounce as soon as it works. Now trembles a lot when content is
        // smaller than the container and we move it …
        cap(
            boundaries[0],
            boundaries[1],
            operation(previousTranslation, currentTranslation),
            operation,
        ),
    );
}


/**
 * When zooming in, we need to enlarge the pannable area and therefore adjust the boundaries set
 * by the user.
 * @param {Number} originalValue        Original boundary value
 * @param {Animated.Node} zoom          Current zoom factor by which we need to enlarge or shrink
 *                                      the boundaries
 * @param {Number} contentWidth         Width of the content; boundary will be enlarged by a
 *                                      multiple of it.
 * @param {Animated.Node} operation     Operation to be performed on originalValue (sub or add)
 */
function getAdjustedBounds(originalValue, zoom, contentWidth, operation) {
    return operation(
        originalValue,
        multiply(
            sub(zoom, 1),
            divide(contentWidth, 2),
        ),
    );
}



/**
 * Pan and pinch handler.
 * - Renders children passed to it.
 * - Adds props animatedZoom, animatedLeft and animatedTop (all of type Animated.Node) to *all*
 *   its children. Children may use those to position themselves depending on the user's
 *   interactions.
 * - Re-render/initialize component when layout changes! (As we only measure layout on init of the
 *   component)
 * - TODO: Use as HOC instead of child-rendering component
 */
export default class PanPinch extends React.Component {

    // TODO: Fuck, if we change state through props *after* it was initialized, this won't affect
    // cappedZoom as it's not a Value (and cappedZoom is defined with the original state when the
    // instance is initialized) – we need to wait for Value.set().
    state = {
        // Setting ranges to Infinity crashes the app, reanimated seems to be unable to handle
        // it (well, who is)
        containerDimensions: [100, 100],
        contentDimensions: [20, 20],
        zoomRange: [0.25, 2],
    }

    panHandler = React.createRef();
    pinchHandler = React.createRef();



    /**
     * We may set containerDimensions and contentDimensions through props. From these, we need to
     * get xRange and yRange that limit a user's panning to certain boundaries.
     */
    static getDerivedStateFromProps(props) {

        const newState = {};
        // Seems to break everything on iOS if console is inactive

        if (props.containerDimensions) {
            if (
                Array.isArray(props.containerDimensions) &&
                props.containerDimensions.length === 2
            ) {
                newState.containerDimensions = props.containerDimensions;
            } else {
                console.log('PanPinch: Invalid containerDimensions', props.containerDimensions);
            }
        }

        if (props.contentDimensions) {
            if (
                Array.isArray(props.contentDimensions) &&
                props.contentDimensions.length === 2
            ) {
                newState.contentDimensions = props.contentDimensions;
            } else {
                console.log('PanPinch: Invalid contentDimensions', props.contentDimensions);
            }
        }

        if (props.zoomRange) {
            if (
                Array.isArray(props.zoomRange) &&
                props.contentDimensions.length === 2
            ) {
                newState.zoomRange = props.zoomRange;
            } else {
                console.log('PanPinch: Invalid zoomRange', props.zoomRange);
            }
        }

        console.log('PanPinch: Return derived state');
        return newState;

    }


    render() {

        const [containerWidth, containerHeight] = this.state.containerDimensions;
        const [contentWidth, contentHeight] = this.state.contentDimensions;

        /* if (containerWidth >= contentWidth) {
            xRange = [0, containerWidth - contentWidth];
        } else {
            xRange = [contentWidth * -1 + containerWidth, 0];
        }
        if (containerHeight >= contentHeight) {
            yRange = [0, containerHeight - contentHeight];
        } else {
            yRange = [contentHeight * -1 + containerHeight, 0];
        } */

        // We must use reanimated functions here as state.contentDimensions and
        // state.containerDimensions might be Animated.Values
        const xRangeMin = cond(
            greaterOrEq(containerWidth, contentWidth),
            0,
            sub(containerWidth, contentWidth),
        );

        const xRangeMax = cond(
            greaterOrEq(containerWidth, contentWidth),
            sub(containerWidth, contentWidth),
            0,
        );

        const yRangeMin = cond(
            greaterOrEq(containerHeight, contentHeight),
            0,
            sub(containerHeight, contentHeight),
        );

        const yRangeMax = cond(
            greaterOrEq(containerHeight, contentHeight),
            sub(containerHeight, contentHeight),
            0,
        );


        // TODO: Move to properties to better distribute content/keep methods short.
        // Crashes iOS app now *if* debugging is disabled.
        const previousTransforms = {
            x: new Value(0),
            y: new Value(0),
            zoom: new Value(1),
        };

        const currentTransforms = {
            x: new Value(0),
            y: new Value(0),
            zoom: new Value(1),
        };

        const gestureStates = {
            pan: new Value(-1),
            pinch: new Value(-1),
        };

        const resultingZoom = updateTranslation(
            previousTransforms.zoom,
            currentTransforms.zoom,
            gestureStates.pinch,
            this.state.zoomRange,
            multiply,
            1,
        );


        // Don't use resultingZoom to set adjusted range limits; they are larger than the actual
        // boundaries when pinchGesture ends (just before they snap back)
        const cappedEffectiveZoom = block([
            debug('PanPinch: Current zoom is', currentTransforms.zoom),
            cap(
                this.state.zoomRange[0],
                this.state.zoomRange[1],
                multiply(
                    previousTransforms.zoom,
                    currentTransforms.zoom,
                ),
            ),
        ]);


        // TODO: When/if we re-add bounce effect (spring-like when extending over boundaries),
        // only update adjustedMin/Max when gesture ends:
        // let adjustedXMin = new Value(this.state.xRange[0]);
        // adjustedXMin = cond(
        //    eq(this.gestureStates.pinch, State.BEGAN),
        //    currentCodeHere
        //    adjustedXMin, // Just return previous value
        // );

        // We have to extend/contract boundaries when we zoom in (see getAdjustedBounds).
        // Only update boundaries when  pinch gesture ends. If we update in real time, we get
        // some nasty rendering issues.
        const adjustedXMin = getAdjustedBounds(
            xRangeMin,
            cappedEffectiveZoom,
            contentWidth,
            sub,
        );

        const adjustedXMax = getAdjustedBounds(
            xRangeMax,
            cappedEffectiveZoom,
            contentWidth,
            add,
        );

        const adjustedYMin = getAdjustedBounds(
            yRangeMin,
            cappedEffectiveZoom,
            contentHeight,
            sub,
        );

        const adjustedYMax = getAdjustedBounds(
            yRangeMax,
            cappedEffectiveZoom,
            contentHeight,
            add,
        );


        const resultingXTranslation = block([
            debug('PanPinch: xMin', xRangeMin),
            debug('PanPinch: adjusted xMin', adjustedXMin),
            updateTranslation(
                previousTransforms.x,
                currentTransforms.x,
                gestureStates.pan,
                [adjustedXMin, adjustedXMax],
            ),
        ]);

        const resultingYTranslation = updateTranslation(
            previousTransforms.y,
            currentTransforms.y,
            gestureStates.pan,
            [adjustedYMin, adjustedYMax],
        );

        const onPanStateChange = event([{
            nativeEvent: {
                state: gestureStates.pan,
            },
        }]);

        const onPanGestureEvent = event([{
            nativeEvent: {
                translationX: currentTransforms.x,
                translationY: currentTransforms.y,
            },
        }]);

        const onPinchStateChange = event([{
            nativeEvent: {
                state: gestureStates.pinch,
            },
        }]);

        const onPinchGestureEvent = event([{
            nativeEvent: {
                scale: currentTransforms.zoom,
            },
        }]);

        console.log('PanPinch: Rendering');

        return (
            <View style={styles.container}>
                { /* Only render stuff when we know the window's dimensions, needed to cap */ }
                <PanGestureHandler
                    ref={this.panHandler}
                    // minDist={20}
                    // minPointers={2}
                    simultaneousHandlers={this.pinchHandler}
                    onHandlerStateChange={onPanStateChange}
                    onGestureEvent={onPanGestureEvent}
                >
                    <Animated.View style={styles.container}>
                        <PinchGestureHandler
                            ref={this.pinchHandler}
                            simultaneousHandlers={this.panHandler}
                            onHandlerStateChange={onPinchStateChange}
                            onGestureEvent={onPinchGestureEvent}
                        >
                            { /* If PinchGestureHandler doesn't contain a view, it will be tiny */ }
                            <Animated.View
                                style={styles.container}>

                                { /* Somehow, we have to pass our transformations to the parent
                                     or child component; this is the only way I found worked.
                                     Passing a prop from the parent component and updating it with
                                     set() does not update the parent view. */ }
                                { React.Children.map(this.props.children, child => (
                                    React.cloneElement(child, {
                                        // 'left' or 'translateX' are reserved words
                                        animatedLeft: resultingXTranslation,
                                        animatedTop: resultingYTranslation,
                                        animatedZoom: resultingZoom,
                                    })
                                )) }

                            </Animated.View>
                        </PinchGestureHandler>
                    </Animated.View>
                </PanGestureHandler>
            </View>
        );
    }

}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        width: '100%',
        alignItems: 'flex-start',
        justifyContent: 'flex-start',
    },
});



