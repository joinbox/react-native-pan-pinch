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
    greaterThan,
    pow,
    divide,
} = Animated;


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
    operation = add,
    defaultValue = 0,
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
 * extension (slows down)
 * @param {Number|Value} minValue       Minimum boundary that shouldn't be exceeded
 * @param {Number|Value} maxValue       Maximum boundary that shouldn't be exceeded
 * @param {Number|Value} value          Current value
 * @param {Value} operation             Animated operation that's applied to values (e.g. add
 *                                      or multiply)
 * @return {Animated.Node}
 */
function bounce(minValue, maxValue, value, operation) {

    // No bouncing support for multiplications yet
    if (operation === multiply) return value;

    const exceedsHigh = sub(value, maxValue);
    const exceedsLow = sub(minValue, value);
    return cond(
        greaterThan(exceedsHigh, 0),

        // We're exceeding the upper boundary
        // Use root (x ^ (1/1.3) because square root is too intense in slowing down) for extended
        // property: makes sure we don't overextend.
        operation(maxValue, pow(exceedsHigh, divide(1, 1.3))),

        cond(
            greaterThan(exceedsLow, 0),
            // We're exceeding the lower boundary: Remove reduced difference from min
            operation(
                minValue,
                multiply(
                    pow(exceedsLow, divide(1, 1.3)),
                    -1,
                ),
            ),
            value,
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
        zoomRange: [0.5, 2],
        xRange: [0, 100],
        yRange: [0, 200],
    }

    panHandler = React.createRef();
    pinchHandler = React.createRef();

    /**
     * When a gesture ends, we store the resulting transforms in previousValues; whenever the next
     * gesture happens, it's added to or multiplied with previousTransforms
     */
    previousTransforms = {
        x: new Value(0),
        y: new Value(0),
        zoom: new Value(1),
    }

    /**
     * When user zooms more than is allowed by caps, we store the excess value in this
     * variable and remove it from the user's current zoom factor as soon as he zooms in the
     * opposite direction
     */
    capOffsets = {
        zoom: new Value(1),
    };

    currentTransforms = {
        x: new Value(0),
        y: new Value(0),
        zoom: new Value(1),
    }

    gestureStates = {
        pan: new Value(-1),
        pinch: new Value(-1),
    }

    resultingZoom = updateTranslation(
        this.previousTransforms.zoom,
        this.currentTransforms.zoom,
        this.gestureStates.pinch,
        this.state.zoomRange,
        multiply,
        1,
    );

    resultingXTranslation = updateTranslation(
        this.previousTransforms.x,
        this.currentTransforms.x,
        this.gestureStates.pan,
        this.state.xRange,
    );

    resultingYTranslation = updateTranslation(
        this.previousTransforms.y,
        this.currentTransforms.y,
        this.gestureStates.pan,
        this.state.yRange,
    );

    onPanStateChange = event([{
        nativeEvent: {
            state: this.gestureStates.pan,
        },
    }]);

    onPanGestureEvent = event([{
        nativeEvent: {
            translationX: this.currentTransforms.x,
            translationY: this.currentTransforms.y,
        },
    }]);

    onPinchStateChange = event([{
        nativeEvent: {
            state: this.gestureStates.pinch,
        },
    }]);

    onPinchGestureEvent = event([{
        nativeEvent: {
            scale: this.currentTransforms.zoom,
        },
    }]);

    /* static getDerivedStateFromProps(props) {
        console.log('new props', props);
        return {
            zoomRange: props.zoomRange
        };
    } */

    render() {
        console.log('RENDERING', this.cappedTranslation, this.state);
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



