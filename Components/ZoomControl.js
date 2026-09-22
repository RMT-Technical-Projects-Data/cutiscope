import React, { useState } from 'react';
import { StyleSheet, View, Text, Dimensions } from 'react-native';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withSpring,
    runOnJS,
    useAnimatedReaction,
} from 'react-native-reanimated';

const { width } = Dimensions.get('window');
const RULER_WIDTH = width * 0.8;
const KNOB_SIZE = 40;
const MAX_RANGE = RULER_WIDTH - KNOB_SIZE;

// ==========================================
// ZOOM RULER COMPONENT (The Overlay Visual)
// ==========================================
// ==========================================
// ZOOM RULER COMPONENT (The Overlay Visual AND Interactive Slider)
// ==========================================
export const ZoomRuler = ({ zoom, minZoom, maxZoom, onZoomChange, disabled }) => {
    const startX = useSharedValue(0);

    const pan = Gesture.Pan()
        .enabled(!disabled)
        .onStart(() => {
            const currentPos = ((zoom.value - minZoom) / (maxZoom - minZoom)) * MAX_RANGE;
            startX.value = currentPos;
        })
        .onUpdate((event) => {
            let position = startX.value + event.translationX;
            position = Math.max(0, Math.min(position, MAX_RANGE));

            const newZoom = minZoom + (position / MAX_RANGE) * (maxZoom - minZoom);
            zoom.value = newZoom;

            if (onZoomChange) {
                runOnJS(onZoomChange)(newZoom);
            }
        });

    const animatedContainerStyle = useAnimatedStyle(() => {
        // Show bar if zoom > minZoom significantly
        const isVisible = zoom.value > minZoom + 0.05;
        return {
            opacity: withSpring(isVisible ? 1 : 0, { damping: 20, stiffness: 200 }),
        };
    });

    const animatedKnobStyle = useAnimatedStyle(() => {
        const position = ((zoom.value - minZoom) / (maxZoom - minZoom)) * MAX_RANGE;
        return {
            transform: [{ translateX: position }],
        };
    });

    const animatedProgressStyle = useAnimatedStyle(() => {
        const position = ((zoom.value - minZoom) / (maxZoom - minZoom)) * MAX_RANGE;
        return {
            width: position,
            left: KNOB_SIZE / 2
        }
    });

    const zoomSteps = [];
    for (let i = Math.floor(minZoom); i <= Math.floor(maxZoom); i++) {
        zoomSteps.push(i);
    }

    return (
        <GestureDetector gesture={pan}>
            <Animated.View 
                style={[styles.rulerContainer, animatedContainerStyle, disabled && { opacity: 0.5 }]}
                pointerEvents={disabled ? "none" : "auto"}
            >
                {/* Ruler Background Track */}
                <View style={styles.trackBackground}>
                    <Animated.View style={[styles.trackProgress, animatedProgressStyle]} />
                </View>

                {/* Ruler Ticks */}
                <View style={styles.tickMarksContainer}>
                    {zoomSteps.map((val) => {
                        const pos = (val - minZoom) / (maxZoom - minZoom);
                        return (
                            <View key={val} style={[styles.rulerTick, { left: pos * MAX_RANGE + KNOB_SIZE / 2 - 1 }]} />
                        );
                    })}
                </View>

                {/* Moving Knob Indicator */}
                <Animated.View style={[styles.knob, animatedKnobStyle]}>
                    <View style={styles.knobInner} />
                </Animated.View>

                <View style={styles.labels}>
                    {zoomSteps.map((val) => {
                        const pos = (val - minZoom) / (maxZoom - minZoom);
                        return (
                            <Text key={val} style={[styles.labelText, {
                                position: 'absolute',
                                left: pos * MAX_RANGE + KNOB_SIZE / 2 - 15,
                                width: 30,
                                textAlign: 'center'
                            }]}>{val}x</Text>
                        );
                    })}
                </View>
            </Animated.View>
        </GestureDetector>
    );
};

// ==========================================
// ZOOM CONTROL COMPONENT (The Interactive Button)
// ==========================================
const ZOOM_SENSITIVITY = 150; // Pixels to cover full range

// ==========================================
// ZOOM CONTROL COMPONENT (The Interactive Button)
// Vertical Drag for "One-Go" Handling
// ==========================================
const ZoomControl = ({ zoom, minZoom = 1, maxZoom = 5, onZoomChange, currentZoom, disabled }) => {
    const startY = useSharedValue(0);
    const startZoom = useSharedValue(minZoom);
    const [internalDisplayZoom, setInternalDisplayZoom] = useState(minZoom);

    useAnimatedReaction(
        () => zoom.value,
        (val) => {
            if (currentZoom === undefined) {
                runOnJS(setInternalDisplayZoom)(Math.round(val * 10) / 10);
            }
        },
        [minZoom, maxZoom, currentZoom]
    );

    const displayZoom = currentZoom !== undefined ? (Math.round(currentZoom * 10) / 10) : internalDisplayZoom;

    const pan = Gesture.Pan()
        .enabled(!disabled)
        .onStart(() => {
            startZoom.value = zoom.value;
            startY.value = 0;
        })
        .onUpdate((event) => {
            // Negative translationY (dragging up) should INCREASE zoom
            const deltaY = -event.translationY;

            // Calculate zoom change based on sensitivity
            const zoomDelta = (deltaY / ZOOM_SENSITIVITY) * (maxZoom - minZoom);

            let newZoom = startZoom.value + zoomDelta;
            newZoom = Math.max(minZoom, Math.min(newZoom, maxZoom));
            zoom.value = newZoom;

            if (onZoomChange) {
                runOnJS(onZoomChange)(newZoom);
            }
        })
        .onEnd(() => {
            // Optional: Snap or inertia can be added here
        });

    // Circular Progress Visuals
    const radius = 38;
    const strokeWidth = 3;
    const circumference = 2 * Math.PI * radius; // ~238

    const animatedCircleStyle = useAnimatedStyle(() => {
        const progress = (zoom.value - minZoom) / (maxZoom - minZoom);
        const clampedProgress = Math.max(0, Math.min(progress, 1));

        // StrokeDashoffset: Circumference * (1 - progress)
        // We want it to fill clockwise from top? SVG might be needed for perfect circle,
        // but we can simulate with Views or just use a simple vertical bar if circle is too complex without SVG.
        // Let's stick to a clean vertical filling background or just the text for now, 
        // effectively implementing the drag behavior is priority #1.

        // Let's allow the ticks to animate?
        return {};
    });

    return (
        <GestureDetector gesture={pan}>
            <View 
                style={[styles.compactContainer, disabled && { opacity: 0.5 }]}
                pointerEvents={disabled ? "none" : "auto"}
            >
                {/* Visual Feedback Circle (Static Background) */}
                <View style={styles.zoomKnobBackground}>
                    {/* Dynamic Text – use state to avoid reading shared value during render */}
                    <Text style={styles.compactText}>{displayZoom}x</Text>

                    {/* Direction Indicators */}
                    <View style={styles.directionIndicators}>
                        <Text style={styles.arrowText}>▲</Text>
                        <Text style={styles.arrowText}>▼</Text>
                    </View>
                </View>
            </View>
        </GestureDetector>
    );
};

const styles = StyleSheet.create({
    // Ruler Styles
    rulerContainer: {
        width: RULER_WIDTH,
        height: 60,
        justifyContent: 'center',
    },
    trackBackground: {
        position: 'absolute',
        width: '100%',
        height: 4,
        backgroundColor: 'transparent',
        borderRadius: 2,
        overflow: 'hidden',
    },
    trackProgress: {
        height: '100%',
        backgroundColor: '#22B2A6',
    },
    tickMarksContainer: {
        position: 'absolute',
        width: '100%',
        height: 10,
        top: 33,
    },
    rulerTick: {
        position: 'absolute',
        width: 2,
        height: 10,
        backgroundColor: 'rgba(255,255,255,0.5)',
    },
    knob: {
        position: 'absolute',
        left: 0,
        width: KNOB_SIZE,
        height: KNOB_SIZE,
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 10,
    },
    knobInner: {
        width: 20,
        height: 20,
        borderRadius: 10,
        backgroundColor: '#22B2A6',
        borderWidth: 2,
        borderColor: '#FFFFFF',
    },
    labels: {
        position: 'absolute',
        bottom: 0,
        width: '100%',
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingHorizontal: KNOB_SIZE / 2,
    },
    labelText: {
        color: '#FFFFFF',
        fontSize: 10,
        top: -10,
        fontWeight: '600',
        textShadowColor: 'rgba(0, 0, 0, 0.75)',
        textShadowRadius: 2,
    },

    // Compact Button Styles
    compactContainer: {
        width: '100%',
        height: '100%',
        justifyContent: 'center',
        alignItems: 'center',
    },
    zoomKnobBackground: {
        width: 70,
        height: 70,
        borderRadius: 35,
        backgroundColor: 'rgba(30,30,30,0.8)',
        borderWidth: 1,
        borderColor: '#22B2A6',
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#000',
        elevation: 5,
    },
    compactText: {
        color: '#fff',
        fontWeight: 'bold',
        fontSize: 18,
        fontFamily: 'ProductSans-Bold',
    },
    directionIndicators: {
        position: 'absolute',
        right: -15,
        height: '100%',
        justifyContent: 'center',
        gap: 20,
        opacity: 0.6,
    },
    arrowText: {
        color: '#22B2A6',
        fontSize: 12,
        fontWeight: '900',
    },
});

export default ZoomControl;
