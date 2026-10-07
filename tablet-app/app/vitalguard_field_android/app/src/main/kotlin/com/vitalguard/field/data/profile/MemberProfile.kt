package com.vitalguard.field.data.profile

import com.vitalguard.field.data.models.JsonObject

/** Only an already-masked number can reach rendering, including accessibility semantics. */
fun safeMaskedPhone(value: String?): String? = value?.trim()?.takeIf {
    it.length <= 24 && Regex("^[0-9]{3}[-* ]*\\*[-* ]*[0-9]{2}$").matches(it) && it.count(Char::isDigit) == 5
}

data class MemberProfile(val username: String, val name: String?, val role: String?, val company: String?,
    val department: String?, val jobTitle: String?, val employeeId: String?, val phoneMasked: String?, val email: String?) {
    companion object {
        fun fromJson(json: JsonObject): MemberProfile {
            fun text(key: String) = (json[key] as? String)?.trim()?.takeIf { it.isNotEmpty() }?.take(200)
            return MemberProfile(requireNotNull(text("username")), text("name"), text("role"), text("company"),
                text("department"), text("jobTitle"), text("employeeId"), safeMaskedPhone(text("phoneMasked")), text("email"))
        }
    }
}
