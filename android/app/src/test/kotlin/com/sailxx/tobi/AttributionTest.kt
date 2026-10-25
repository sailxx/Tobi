package com.sailxx.tobi

import org.junit.Assert.assertEquals
import org.junit.Test

class AttributionTest {
    @Test fun nameAndRepoAreTobis() {
        assertEquals("Tobi for Android", Attribution.APP_NAME)
        assertEquals("https://github.com/sailxx/Tobi", Attribution.REPO_URL)
    }
}
