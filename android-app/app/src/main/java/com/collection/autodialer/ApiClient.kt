package com.collection.autodialer

import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

object ApiClient {
    // Replace with your Cloudflare Pages URL after deployment
    // e.g. "https://debtflow-dialer.pages.dev"
    var BASE_URL = "https://your-cloudflare-pages-domain.pages.dev"

    fun post(endpoint: String, payload: JSONObject): Result<JSONObject> {
        return try {
            val url = URL("$BASE_URL$endpoint")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.setRequestProperty("Content-Type", "application/json; utf-8")
            conn.setRequestProperty("Accept", "application/json")
            conn.doOutput = true
            conn.connectTimeout = 10000
            conn.readTimeout = 10000

            val writer = OutputStreamWriter(conn.outputStream)
            writer.write(payload.toString())
            writer.flush()
            writer.close()

            val responseCode = conn.responseCode
            val inputStream = if (responseCode in 200..299) conn.inputStream else conn.errorStream
            val reader = BufferedReader(InputStreamReader(inputStream))
            val response = StringBuilder()
            var line: String?
            while (reader.readLine().also { line = it } != null) {
                response.append(line)
            }
            reader.close()

            val jsonResponse = JSONObject(response.toString())
            if (responseCode in 200..299) {
                Result.success(jsonResponse)
            } else {
                val errorMsg = jsonResponse.optString("error", "HTTP Error $responseCode")
                val errorCode = jsonResponse.optString("code", "")
                Result.failure(ApiException(errorMsg, errorCode, responseCode))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    fun get(endpoint: String): Result<JSONObject> {
        return try {
            val url = URL("$BASE_URL$endpoint")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "GET"
            conn.setRequestProperty("Accept", "application/json")
            conn.connectTimeout = 10000
            conn.readTimeout = 10000

            val responseCode = conn.responseCode
            val inputStream = if (responseCode in 200..299) conn.inputStream else conn.errorStream
            val reader = BufferedReader(InputStreamReader(inputStream))
            val response = StringBuilder()
            var line: String?
            while (reader.readLine().also { line = it } != null) {
                response.append(line)
            }
            reader.close()

            val jsonResponse = JSONObject(response.toString())
            if (responseCode in 200..299) {
                Result.success(jsonResponse)
            } else {
                val errorMsg = jsonResponse.optString("error", "HTTP Error $responseCode")
                val errorCode = jsonResponse.optString("code", "")
                Result.failure(ApiException(errorMsg, errorCode, responseCode))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}

class ApiException(message: String, val code: String, val statusCode: Int) : Exception(message)
