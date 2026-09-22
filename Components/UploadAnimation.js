import React from 'react';
import { StyleSheet, Text, View, ActivityIndicator } from 'react-native';

const UploadAnimation = () => {
    return (
        <View style={styles.container}>
            <View style={styles.content}>
                <Text style={styles.text}>
                    Uploading to Cloud Storage {'\n'}Please wait...
                </Text>
                <ActivityIndicator size="large" color="#00bb00" />
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: 'white',
        justifyContent: 'center',
        alignItems: 'center',
    },
    content: {
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20, // Optional: Adds spacing around content
    },
    text: {
        fontFamily: 'ProductSans-Regular',
        color: 'black',
        fontSize: 18,
        textAlign: 'center',
        marginBottom: 20, // Adds spacing between the text and spinner
    },
});

export default UploadAnimation;