/**
 * Debug Test Utilities for Audio Pipeline
 * Use these functions in browser console to test pipeline functionality
 */

export const debugTest = {
  /**
   * Test VAD calibration by simulating different noise levels
   */
  testVADCalibration: () => {
    console.log('🔧 VAD Calibration Test');
    console.log('1. Speak normally for 5-10 seconds');
    console.log('2. Stay silent for 5-10 seconds');
    console.log('3. Check debug panel for calibration status');
    console.log('4. Verify threshold adapts to your environment');
  },

  /**
   * Test TTS interruption system
   */
  testTTSInterruption: () => {
    console.log('🛑 TTS Interruption Test');
    console.log('1. Say something to trigger a response');
    console.log('2. While TTS is playing, start speaking again');
    console.log('3. TTS should stop immediately');
    console.log('4. Check debug panel for interruption events');
  },

  /**
   * Test complete conversation flow
   */
  testFullPipeline: () => {
    console.log('🔄 Complete Pipeline Test');
    console.log('1. Enable debug panel');
    console.log('2. Say: "Hello, how are you today?"');
    console.log('3. Monitor pipeline events in debug panel:');
    console.log('   - VAD Trigger → Audio Capture → Transcription Start/End');
    console.log('   - LLM Start/End → TTS Start/End → Playback Start/End');
    console.log('4. Verify timing delays are reasonable (<2s total)');
  },

  /**
   * Test error handling
   */
  testErrorHandling: () => {
    console.log('⚠️  Error Handling Test');
    console.log('1. Test with very quiet speech (should show calibration)');
    console.log('2. Test with background noise (should adapt threshold)'); 
    console.log('3. Test network interruption (should show reconnection)');
    console.log('4. Check error states in debug panel');
  },

  /**
   * Performance test with rapid speech
   */
  testPerformance: () => {
    console.log('⚡ Performance Test');
    console.log('1. Speak rapidly: "One two three four five"');
    console.log('2. Immediately say: "Six seven eight nine ten"');
    console.log('3. Check if system handles rapid speech transitions');
    console.log('4. Verify no duplicate processing in debug panel');
  },

  /**
   * Monitor current pipeline state
   */
  getCurrentState: () => {
    const audioManager = (window as any).audioManagerDebug;
    if (audioManager) {
      console.log('📊 Current Pipeline State:', audioManager);
    } else {
      console.log('⚠️  Audio manager debug info not available');
      console.log('Make sure debug panel is open and system is running');
    }
  }
};

// Make debug test available globally in development
if (process.env.NODE_ENV === 'development') {
  (window as any).debugTest = debugTest;
  console.log('🔬 Debug Test Utils loaded - use window.debugTest in console');
}