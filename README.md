# Intro

This is a pan and pinch component for React Native that
- handles touch inputs (zooming and panning)
- limits panning and zooming to boundaries (min and max movements on x and y axis, min and max zoom levels) and 
- sets all required attributes on children to transform them correspondingly.

# Prerequisites

- Your React Native setup must be linked to [React Native Reanimated](https://github.com/kmagiera/react-native-reanimated). 
- If you use an up-to-date version of [Expo](http://expo.io/), React Native Reanimated is preinstalled and already linked.

# Usage

1. Create a child element that will be transformed:

    ```javascript
    // Box.js
    import React from 'react';
    import { StyleSheet } from 'react-native';
    import Animated from 'react-native-reanimated';

    export default class Box extends React.Component {

        render() {
            return (
                 <Animated.View 
                    style={[styles.box, {
                        // props.animatedLeft, props.animatedTop and props.animatedZoom were added
                        // to this component by PanPinch. They are all of type Animated.Node.
                        transform: [{
                            translateX: this.props.animatedLeft,
                        }, {
                            translateY: this.props.animatedTop,
                        }, {
                            scale: this.props.animatedZoom,
                        }],
                    }]}
                />
            );
        }

    }

    const styles = StyleSheet.create({
        box: {
            backgroundColor: "tomato",
            width: 200,
            height: 200,
        },
    });

    ```

1. Create a parent component that renders PanPinch and children you'd like to transform.

    ```javascript
    // App.js

    import React from 'react';
    import PanPinch from 'react-native-pan-pinch';
    import { StyleSheet, View } from 'react-native';
    import Box from './Box';

    export default class App extends React.Component {

        state = {
            dimensions: [],
        }

        handleLayout(ev) {
            const {width, height} = ev.nativeEvent.layout;
            this.setState({ dimensions: [width, height] });
        }

        render() {
            return (
                { /* In this case, we want this view to serve as the boundaries for Box. Therefore
                     we have to view its layout change and update containerDimensions on PanPinch
                     accordingly */ }
                <View
                    style={styles.container}
                    onLayout={(ev) => this.handleLayout(ev)}
                >
                    <PanPinch containerDimensions={this.state.dimensions}>
                        <Box />
                    </PanPinch>
                </View>
            );
        }

    }

    const styles = StyleSheet.create({
        container: {
            width: '80%',
            height: '80%'
        },
    });
    ```

# API

## Props

- **containerDimensions**: Takes an array of 2 numbers (width and height of the boundaries in which
the PanPinch's content can move), e.g. `[200, 400]` if we want to restrict x pan to 200 and y pan
to 400 px.

# Limitations

- Boundaries cannot yet be set; will be added as soon as Expo uses a newer version of React Native Reanimated (setValue doesn't work yet).
- Zoom level is not yet respected for movement boundaries on x and y axis.


