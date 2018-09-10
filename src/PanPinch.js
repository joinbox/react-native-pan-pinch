import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { PanGestureHandler, PinchGestureHandler, State } from 'react-native-gesture-handler';

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
    sub,
    debug,
    greaterThan,
    pow,
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
function bounce(minValue, maxValue, value) {

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
                    pow(exceedsLowRelatively, 0.25),
                ),
            ),
            value,
        ),
    );
}



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
        bounce(
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
 * - Pass in variables (Animated.Value for react-native-reanimated) for left, top and zoom; they
 *   will be updated and can be used in child components.
 * - Re-render/initialize component when layout changes! (As we only measure layout on init of the
 *   component)
 */
export default class PanPinch extends React.Component {

    // TODO: Fuck, if we change state through props *after* it was initialized, this won't affect
    // cappedZoom as it's not a Value (and cappedZoom is defined with the original state when the
    // instance is initialized) – we need to wait for Value.set().
    state = {
        // Setting ranges to Infinity crashes the app, reanimated seems to be unable to handle
        // it (well, who is)
        containerDimensions: [0, 0],
        contentDimensions: [0, 0],
        zoomRange: [0.25, 2],
        xRange: [0, 100],
        yRange: [0, 200],
    }

    panHandler = React.createRef();
    pinchHandler = React.createRef();


    constructor(...props) {
        super(...props);
        this.setupProperties();
    }


    /**
     * This is BS, but necessary. TODO: When setValue is available, make all props regular props
     * and use setValue() to update boundaries from parent element!
     */
    setupProperties() {

        /**
         * When a gesture ends, we store the resulting transforms in previousValues; whenever the
         * next gesture happens, it's added to or multiplied with previousTransforms
         */
        this.previousTransforms = {
            x: new Value(0),
            y: new Value(0),
            zoom: new Value(1),
        };

        /**
         * When user zooms more than is allowed by caps, we store the excess value in this
         * variable and remove it from the user's current zoom factor as soon as he zooms in the
         * opposite direction
         */
        this.capOffsets = {
            zoom: new Value(1),
        };

        this.currentTransforms = {
            x: new Value(0),
            y: new Value(0),
            zoom: new Value(1),
        };

        this.gestureStates = {
            pan: new Value(-1),
            pinch: new Value(-1),
        };

        this.resultingZoom = updateTranslation(
            this.previousTransforms.zoom,
            this.currentTransforms.zoom,
            this.gestureStates.pinch,
            this.state.zoomRange,
            multiply,
            1,
        );


        // Don't use resultingZoom to set adjusted range limits; they are larger than the actual
        // boundaries when pinchGesture ends (just before they snap back)
        const cappedEffectiveZoom = cap(
            this.state.zoomRange[0],
            this.state.zoomRange[1],
            multiply(
                this.previousTransforms.zoom,
                this.currentTransforms.zoom,
            ),
        );



        // We have to extend/contract boundaries when we zoom in (see getAdjustedBounds).
        // Only update boundaries when  pinch gesture ends. If we update in real time, we get
        // some nasty rendering issues.
        let adjustedXMin = new Value(this.state.xRange[0]);
        adjustedXMin = cond(
            eq(this.gestureStates.pinch, State.END),
            getAdjustedBounds(
                this.state.xRange[0],
                cappedEffectiveZoom,
                this.state.contentDimensions[0],
                sub,
            ),
            adjustedXMin, // Just return previous value
        );

        let adjustedXMax = new Value(this.state.xRange[1]);
        adjustedXMax = cond(
            eq(this.gestureStates.pinch, State.END),
            getAdjustedBounds(
                this.state.xRange[1],
                cappedEffectiveZoom,
                this.state.contentDimensions[0],
                add,
            ),
            adjustedXMax, // Just return previous value
        );

        let adjustedYMin = new Value(this.state.yRange[0]);
        adjustedYMin = cond(
            eq(this.gestureStates.pinch, State.END),
            getAdjustedBounds(
                this.state.yRange[0],
                cappedEffectiveZoom,
                this.state.contentDimensions[1],
                sub,
            ),
            adjustedYMin,
        );

        let adjustedYMax = new Value(this.state.yRange[1]);
        adjustedYMax = cond(
            eq(this.gestureStates.pinch, State.END),
            getAdjustedBounds(
                this.state.yRange[1],
                cappedEffectiveZoom,
                this.state.contentDimensions[1],
                add,
            ),
            adjustedYMax,
        );




        this.resultingXTranslation = updateTranslation(
            this.previousTransforms.x,
            this.currentTransforms.x,
            this.gestureStates.pan,
            [adjustedXMin, adjustedXMax],
        );

        this.resultingYTranslation = updateTranslation(
            this.previousTransforms.y,
            this.currentTransforms.y,
            this.gestureStates.pan,
            [adjustedYMin, adjustedYMax],
        );

        this.onPanStateChange = event([{
            nativeEvent: {
                state: this.gestureStates.pan,
            },
        }]);

        this.onPanGestureEvent = event([{
            nativeEvent: {
                translationX: this.currentTransforms.x,
                translationY: this.currentTransforms.y,
            },
        }]);

        this.onPinchStateChange = event([{
            nativeEvent: {
                state: this.gestureStates.pinch,
            },
        }]);

        this.onPinchGestureEvent = event([{
            nativeEvent: {
                scale: this.currentTransforms.zoom,
            },
        }]);

    }


    /**
     * We may set containerDimensions and contentDimensions through props. From these, we need to
     * get xRange and yRange that limit a user's panning to certain boundaries.
     */
    static getDerivedStateFromProps(props, state) {
        const newState = {};
        console.log('PanPinch: get state from props', props, state);

        if (props.containerDimensions) {
            if (
                Array.isArray(props.containerDimensions) &&
                props.containerDimensions.length === 2
            ) {
                newState.containerDimensions = props.containerDimensions;
            }
        }

        if (props.contentDimensions) {
            if (
                Array.isArray(props.contentDimensions) &&
                props.contentDimensions.length === 2
            ) {
                newState.contentDimensions = props.contentDimensions;
            }
        }

        // Geet container and content width/height from either new or previous state
        const [containerWidth, containerHeight] = newState.containerDimensions ||
            state.containerDimensions;
        const [contentWidth, contentHeight] = newState.contentDimensions || state.contentDimensions;

        // If all widths and heights are available, calculate xRange and yRange
        if (containerWidth && containerHeight && contentWidth && contentHeight) {
            let xRange;
            let yRange;
            if (containerWidth > contentWidth) {
                xRange = [0, containerWidth - contentWidth];
            } else {
                xRange = [contentWidth * -1 + containerWidth, 0];
            }
            if (containerHeight > contentHeight) {
                yRange = [0, containerHeight - contentHeight];
            } else {
                yRange = [contentHeight * -1 + containerHeight, 0];
            }
            newState.xRange = xRange;
            newState.yRange = yRange;
        }

        console.log('PanPinch: New state is', newState);
        return newState;
    }


    render() {
        console.log('RENDERING', this.cappedTranslation, this.state);
        this.setupProperties();
        return (
            <View style={styles.container}>
                { /* Only render stuff when we know the window's dimensions, needed to cap */ }
                <PanGestureHandler
                    ref={this.panHandler}
                    simultaneousHandlers={this.pinchHandler}
                    onHandlerStateChange={this.onPanStateChange}
                    onGestureEvent={this.onPanGestureEvent}
                >
                    <Animated.View style={styles.container}>
                        <PinchGestureHandler
                            ref={this.pinchHandler}
                            simultaneousHandlers={this.panHandler}
                            onHandlerStateChange={this.onPinchStateChange}
                            onGestureEvent={this.onPinchGestureEvent}
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
                                        animatedLeft: this.resultingXTranslation,
                                        animatedTop: this.resultingYTranslation,
                                        animatedZoom: this.resultingZoom,
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



