﻿#version 330 core
layout (location = 0) out vec4 FragColor;
layout (location = 1) out vec4 occlusionTex;

in vec2 TexCoords;

uniform sampler2D texture_diffuse1;
uniform sampler2D texture_emmissive1;

in vec3 toCameraVector;
in vec3 surfaceNormal;

uniform vec3 sunColor;
uniform vec3 sunDir;

vec3 ambient(){
	float ambientStrength = 0.2; 
    vec3 ambient = ambientStrength * sunColor; 
    return ambient;
}

vec3 diffuse(vec3 normal){
	float diffuseFactor = max(0.0, dot(sunDir, normal));
	const float diffuseConst = 0.75;
	vec3 diffuse = diffuseFactor * sunColor * diffuseConst;
	return diffuse;
}

vec3 specular(vec3 normal){
	float specularFactor = 0.01f;
	vec3 reflectDir = reflect(-sunDir, normal);  
	float spec = pow(max(dot(toCameraVector, reflectDir), 0.0), 32.0);
	vec3 specular = spec * sunColor*specularFactor; 
	return specular;
}

void main() {    
	vec4 texDiffuse = texture(texture_diffuse1, TexCoords);
	float alpha = clamp(texDiffuse.a*2, 0.0, 1.0);
    vec4 objectColor = vec4(texDiffuse.rgb, alpha);

	vec3 amb = ambient();
	vec3 norm = normalize(surfaceNormal);
	vec3 diff = diffuse(norm);
	vec3 spec = specular(norm);

	occlusionTex = vec4(vec3(1.0), alpha);
	FragColor = objectColor*vec4(amb + diff + spec, 1.0);
	gl_FragDepth = gl_FragCoord.z / alpha;
}