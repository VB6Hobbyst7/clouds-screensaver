﻿#version 440 core

in vec2 texCoords;

in vec3 surfaceNormal;
in vec3 vPos;
in vec3 toCameraVector;
in vec4 fragPosLightSpace;
in mat3 TBN;

uniform vec3 sunDir;
uniform vec3 sunColor;

uniform sampler2D healthyGrassTex, grassTex, patchyGrassTex, rockTex, snowTex;
uniform sampler2D healthyGrassNormalTex, grassNormalTex, patchyGrassNormalTex, snowNormalTex;
uniform sampler2D rockNormalMap;
uniform sampler2D shadowMap;
uniform float snowHeight;
uniform float grassCoverage;

uniform vec3 fogColor;
uniform float fogFalloff;

uniform vec3 cameraPos;

layout (location = 0) out vec4 out_color;
layout (location = 1) out vec4 occlusionTex;

struct MaterialProperties {
	vec4 color;
	vec3 normal;
};

// Frequency for sampling textures
const float ROCK_TEX_FREQ = 40.0;
const float SNOW_TEX_FREQ = 40.0;
const float GRASS_TEX_FREQ = 120.0;
const float HEALTHY_GRASS_TEX_FREQ = 50.0;
const float PATCHY_GRASS_TEX_FREQ = 10.0;

vec4 applySnow(in vec4 heightColor, in float height, in float transition, in vec4 snowTex, in vec3 snowNormal, in vec3 normalTex, out vec3 snowedNormalTex) {
	vec4 snowedHeightColor = heightColor;

	if (height >= snowHeight - transition) {
		snowedHeightColor = snowTex;
		snowedNormalTex = snowNormal;
	} else if (height >= snowHeight- 2*transition) {
		snowedHeightColor = mix(snowTex, heightColor, pow(1.3, -height + (snowHeight- 2*transition)));
		snowedNormalTex = mix(snowNormal, normalTex, pow(1.3, -height + (snowHeight- 2*transition)));
	}

	return snowedHeightColor;
}

vec3 getNormalFromNormalMap(in vec3 normalTex) {
	vec3 normal = normalTex;
	normal = normalize(normal * 2.0 - 1.0);
	normal = normalize(TBN * normal);

	return normal;
}

const float c = 18.0;
float applyFog(in float dist,       // camera to point distance
               in vec3  cameraPos,  // camera position
               in vec3  rayDir ) {  // camera to point vector
    float fogAmount = c * exp(-cameraPos.y*fogFalloff) * (1.0-exp( -dist*rayDir.y*fogFalloff ))/rayDir.y;
    return clamp(fogAmount,0.0,1.0);
}

vec4 makeGreener(vec4 color, float greeningFactor) {
	float recipricol = 1.0 / greeningFactor;
	color.r *= recipricol;
	color.b *= recipricol;

	color.g *= greeningFactor;

	return color;
}

MaterialProperties getHeightMaterial() {
	float transition = 20.0;

	float height = vPos.y;

	vec4 rock = texture(rockTex, texCoords*ROCK_TEX_FREQ);
	vec3 rockNormal = texture(rockNormalMap, texCoords*ROCK_TEX_FREQ).xyz;
	vec4 snow = texture(snowTex, texCoords*SNOW_TEX_FREQ);
	vec3 snowNormal = texture(snowNormalTex, texCoords*SNOW_TEX_FREQ).xyz;

	// Mix different grass textures together at differing frequencies to create more natural looking grass
	vec4 grass = texture(grassTex, texCoords*(GRASS_TEX_FREQ)) * 0.6 +
				 texture(healthyGrassTex, texCoords*(HEALTHY_GRASS_TEX_FREQ)) * 0.2 + 
				 texture(patchyGrassTex, texCoords*(PATCHY_GRASS_TEX_FREQ)) * 0.2;
	grass = makeGreener(grass, 1.25);

	// Mix bump maps for grass as well
	vec3 grassNormal = (texture(grassNormalTex, texCoords*(GRASS_TEX_FREQ)).xyz * 0.6 +
					   texture(healthyGrassNormalTex, texCoords*(HEALTHY_GRASS_TEX_FREQ)).xyz * 0.2 +
					   texture(patchyGrassNormalTex, texCoords*(PATCHY_GRASS_TEX_FREQ)).xyz * 0.2);
	grassNormal = mix(grassNormal, vec3(0.0, 1.0, 0.0), 0.2);

	vec3 upVector = vec3(0, 1, 0);

	vec4 heightColor;
	vec3 heightNormal;
	vec3 normal = surfaceNormal;

	float cosV = abs(dot(surfaceNormal, upVector)) / (length(surfaceNormal) * 1.0);
	float tenPercentGrass = grassCoverage - grassCoverage*0.1;

	// Find base texture
	if(cosV > tenPercentGrass) {
		float blendingCoeff = clamp(pow((cosV - tenPercentGrass) / (grassCoverage * 0.1), 1.0), 0.0, 1.0);
		
		heightColor = mix(rock, grass, blendingCoeff);
		heightNormal = mix(rockNormal, grassNormal, blendingCoeff);

		vec4 snowedHeightColor = applySnow(heightColor, height, transition, snow, snowNormal, heightNormal, heightNormal);
		heightColor = mix(heightColor, snowedHeightColor, blendingCoeff);

		
	} else if (cosV > grassCoverage) {
		heightColor = grass;
		heightNormal = grassNormal;

		heightColor = applySnow(heightColor, height, transition, snow, snowNormal, heightNormal, heightNormal);
    } else {
		heightColor = rock;	
		heightNormal = rockNormal;
	}

	normal = getNormalFromNormalMap(heightNormal);
	return MaterialProperties(heightColor, normal);	
}

vec3 ambient(){
	float ambientStrength = 0.2; 
    vec3 ambient = ambientStrength * sunColor; 
    return ambient;
}

vec3 diffuse(vec3 normal){
	float diffuseFactor = max(0.0, dot(-sunDir, normal));
	const float diffuseConst = 0.75;
	vec3 diffuse = diffuseFactor * sunColor * diffuseConst;
	return diffuse;
}

vec3 specular(vec3 normal){
	float specularFactor = 0.01f;
	vec3 reflectDir = reflect(sunDir, normal);  
	float spec = pow(max(dot(toCameraVector, reflectDir), 0.0), 32.0);
	vec3 specular = spec * vec3(1.0)*specularFactor; 
	return specular;
}

float shadowCalculation(vec4 fragPosLightSpace, vec3 normal) {
	vec3 projCoords = fragPosLightSpace.xyz / fragPosLightSpace.w;
	projCoords = projCoords * 0.5 + 0.5;
	
	float closestDepth = texture(shadowMap, projCoords.xy).r;
	float currentDepth = projCoords.z;

	//float shadow = currentDepth - 0.00005 > closestDepth ? 1.0 : 0.0;
	float shadow = 0.0;
	vec2 texelSize = 1.0 / textureSize(shadowMap, 0);
	float bias = max(0.0005 * (1.0 - dot(surfaceNormal, sunDir)), 0.00005);  
	for (int x = -1; x <= 1; ++x) {
		for (int y = -1; y <= 1; ++y) {
			float pcfDepth = texture(shadowMap, projCoords.xy + vec2(x,y) * texelSize).r;
			shadow += currentDepth - bias > pcfDepth ? 1.0 : 0.0;
		}
	}
	shadow /= 9.0;

	if (projCoords.z > 1.0) {
		shadow = 0.0;
	}

	return shadow;
}

void main() {
	MaterialProperties heightMaterial = getHeightMaterial();

	vec3 amb = ambient();
	vec3 diff = diffuse(heightMaterial.normal);
	vec3 spec = specular(heightMaterial.normal);

	float shadow = 1.0 - shadowCalculation(fragPosLightSpace, heightMaterial.normal);

	// Perspective divide
	vec3 projCoords = fragPosLightSpace.xyz / fragPosLightSpace.w;
	// Transform to [0,1] range
	projCoords = projCoords * 0.5 + 0.5;
	
	// Fill terrain occlusion texture
	occlusionTex = vec4(1.0);

	float fogFactor = applyFog(distance(cameraPos, vPos), cameraPos, normalize(vPos - cameraPos));
	vec4 preFogColor = heightMaterial.color*vec4((amb + ((diff + spec) * shadow)) * vec3(1.0), 1.0);
	out_color = mix(preFogColor, vec4(fogColor, 1.0), 1.0-fogFactor);
}