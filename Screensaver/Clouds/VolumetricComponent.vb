﻿Imports OpenTK.Graphics.OpenGL4
Imports OpenTK

Public Class VolumetricComponent
    Private volumetricShader As Shader
    Private postProcessClouds As Shader

    Private quadRenderer As ScreenQuadRenderer
    Private camera As Camera
    Private earth As EarthManager
    Private sun As SunManager
    Private temporalProjection As VolumetricCloudsFrameBuffer

    ' Store previous view projection matrix for temporal reprojection
    Dim oldViewProjection As Matrix4

    Dim frameIter As Integer

    ' Generates noises
    Private perlinWorleyNoiseGen As NoiseGenerator3D
    Private worleyNoiseGen As NoiseGenerator3D
    Private weatherNoiseGen As NoiseGenerator2D
    Private curlNoiseGen As NoiseGenerator2D

    ' Noise cache
    Private perlinWorleyNoise As Integer
    Private worleyNoise As Integer
    Private weatherNoise As Integer
    Private curlNoise As Integer

    ' Clouds resolution
    Private ReadOnly cloudsResolutionWidth As Integer
    Private ReadOnly cloudsResolutionHeight As Integer

    Public Sub New(screenWidth As Integer,
                   screenHeight As Integer,
                   vertexSrc As String,
                   fragSrc As String,
                   ByRef quadRen As ScreenQuadRenderer,
                   ByRef cam As Camera,
                   ByRef earthManager As EarthManager,
                   ByRef sunManager As SunManager)
        cloudsResolutionWidth = screenWidth
        cloudsResolutionHeight = screenHeight
        temporalProjection = New VolumetricCloudsFrameBuffer(cloudsResolutionWidth, cloudsResolutionHeight)

        volumetricShader = New Shader(vertexSrc, fragSrc)
        quadRenderer = quadRen
        camera = cam
        earth = earthManager
        sun = sunManager
        frameIter = 0
        postProcessClouds = New Shader("ScreenQuadRenderer.vert", "PostProcessClouds.frag")
        oldViewProjection = camera.ProjectionMatrix * camera.ViewMatrix

        perlinWorleyNoiseGen = New NoiseGenerator3D("Generate3DPerlinWorleyNoise.comp")
        worleyNoiseGen = New NoiseGenerator3D("Generate3DWorleyNoise.comp")
        weatherNoiseGen = New NoiseGenerator2D("GenerateWeatherTexture.comp")
        curlNoiseGen = New NoiseGenerator2D("Generate2DCurlNoise.comp")

        perlinWorleyNoise = perlinWorleyNoiseGen.GenerateNoise(128,
                                                               128,
                                                               128,
                                                               SizedInternalFormat.Rgba8)

        worleyNoise = worleyNoiseGen.GenerateNoise(32,
                                                   32,
                                                   32,
                                                   SizedInternalFormat.Rgba8)

        weatherNoiseGen.Seed(RandomFloatGenerator.instance().NextFloat())
        weatherNoise = weatherNoiseGen.GenerateNoise(1024,
                                                     1024,
                                                     SizedInternalFormat.Rgba8)

        curlNoise = curlNoiseGen.GenerateNoise(128,
                                               128,
                                               SizedInternalFormat.Rgba8)


        perlinWorleyNoiseGen.AwaitComputationEnd()
        worleyNoiseGen.AwaitComputationEnd()
        weatherNoiseGen.AwaitComputationEnd()
        curlNoiseGen.AwaitComputationEnd()

        volumetricShader.Use()
    End Sub

    Public Sub Render(time As Single, terrainOcclusionTex As Integer, backgroundTex As Integer, colorPreset As Preset)
        volumetricShader.Use()

        ' Set uniforms
        volumetricShader.SetVec2("resolution", cloudsResolutionWidth, cloudsResolutionHeight)
        volumetricShader.SetFloat("time", time)
        volumetricShader.SetVec3("cameraPos", camera.Position)


        Dim inverseView = camera.ViewMatrix.Inverted()
        Dim inverseProjection = camera.ProjectionMatrix.Inverted()
        Dim inverseViewProjection = Matrix4.Mult(camera.ProjectionMatrix, camera.ViewMatrix).Inverted()

        volumetricShader.SetMat4("inverseView", False, inverseView)
        volumetricShader.SetMat4("inverseProjection", False, inverseProjection)
        volumetricShader.SetMat4("inverseViewProjection", False, inverseViewProjection)
        volumetricShader.SetMat4("oldViewProjection", False, oldViewProjection)

        volumetricShader.SetVec3("CLOUDS_AMBIENT_COLOR_BOTTOM", colorPreset.cloudColorBottom)

        volumetricShader.SetVec3("lightColor", colorPreset.lightColor)
        volumetricShader.SetVec3("sunDir", sun.lightDir)
        volumetricShader.SetFloat("EARTH_RADIUS", earth.radius)
        volumetricShader.SetInt("frameIter", frameIter)

        ' Set configuration manager settings
        volumetricShader.SetFloat("CLOUD_SPEED", ConfigManager.Instance.CloudsSpeed)
        volumetricShader.SetFloat("WEATHER_SCALE", ConfigManager.Instance.WeatherScale)
        volumetricShader.SetFloat("CURLINESS", ConfigManager.Instance.CloudsCurliness)

        ' Set texture units
        volumetricShader.SetInt("cloudNoise", 1)
        volumetricShader.SetInt("weatherTexture", 2)
        volumetricShader.SetInt("curlNoise", 3)
        volumetricShader.SetInt("worleyNoise", 4)
        volumetricShader.SetInt("lastFrame", 5)
        volumetricShader.SetInt("lastFrameAlphaness", 6)
        volumetricShader.SetInt("terrainOcclusion", 7)
        volumetricShader.SetInt("background", 8)

        ' Activate texture units
        GL.ActiveTexture(TextureUnit.Texture1)
        GL.BindTexture(TextureTarget.Texture3D, perlinWorleyNoise)
        GL.ActiveTexture(TextureUnit.Texture2)
        GL.BindTexture(TextureTarget.Texture2D, weatherNoise)
        GL.ActiveTexture(TextureUnit.Texture3)
        GL.BindTexture(TextureTarget.Texture2D, curlNoise)
        GL.ActiveTexture(TextureUnit.Texture4)
        GL.BindTexture(TextureTarget.Texture3D, worleyNoise)
        GL.ActiveTexture(TextureUnit.Texture5)
        GL.BindTexture(TextureTarget.Texture2D, temporalProjection.lastFrame)
        GL.ActiveTexture(TextureUnit.Texture6)
        GL.BindTexture(TextureTarget.Texture2D, temporalProjection.lastFrameAlphaness)
        GL.ActiveTexture(TextureUnit.Texture7)
        GL.BindTexture(TextureTarget.Texture2D, terrainOcclusionTex)
        GL.ActiveTexture(TextureUnit.Texture8)
        GL.BindTexture(TextureTarget.Texture2D, backgroundTex)

        ' Cache view projection matrix for temporal reprojection
        oldViewProjection = Matrix4.Mult(camera.ProjectionMatrix, camera.ViewMatrix)

        ' Render volumetric to FBO
        temporalProjection.Bind()
        quadRenderer.Render()
        temporalProjection.UnBind()

        ' Increment frame iter counter modulus 4 for temporal reprojection bayer matrix
        frameIter = (frameIter + 1) Mod 4
    End Sub

    Public Sub Blit()
        ' Blit volumetric clouds to screen with post processing
        postProcessClouds.Use()
        postProcessClouds.SetInt("textureToDraw", 0)
        postProcessClouds.SetVec2("resolution", New Vector2(cloudsResolutionWidth, cloudsResolutionHeight))
        GL.ActiveTexture(TextureUnit.Texture0)
        GL.BindTexture(TextureTarget.Texture2D, temporalProjection.currentFrame)
        quadRenderer.Render()
    End Sub

    ' Allow retrieval of cloud occlusion for God rays
    Public ReadOnly Property OcclusionTexture As Integer
        Get
            Return temporalProjection.lastFrameAlphaness
        End Get
    End Property
End Class
